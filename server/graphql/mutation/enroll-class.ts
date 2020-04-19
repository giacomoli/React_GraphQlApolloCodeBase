import Boom from 'boom';
import { CreditType, ReferralCredits } from 'cl-common';
import {
  ClassModel,
  CourseModel,
  CreditModel,
  EnrollmentModel,
  PromotionModel,
  StudentModel,
  TransactionModel
} from 'cl-models';
import { addBreadcrumb } from 'cl-sentry';
import { Request } from 'express';
import { Op } from 'sequelize';
import {
  applyCredit,
  applyPromo,
  getTotalPriceInCents
} from '../../../shared/pricing';
import { MutationArgs, StudentIdVars } from '../../../types';
import { sale } from '../../braintree/braintree';
import { emitEnrollClassEvent } from '../../lib/event-bus';
import logger from '../../lib/logger';
import sequelize from '../../sequelize';
import { getPromotionIfQualified } from '../helper/promo-helper';

async function getStudent(args: StudentIdVars, req: Request) {
  return StudentModel.findOne({
    rejectOnEmpty: true,
    where: {
      id: args.studentId,
      parentId: req.userId
    }
  });
}

export async function enrollTrial(
  root,
  args: MutationArgs.EnrollTrial,
  req: Request
) {
  if (!req.userId) {
    throw Boom.unauthorized('You must login first');
  }

  const [student, klass] = await Promise.all([
    getStudent(args, req),
    ClassModel.findByPk(args.classId, {
      rejectOnEmpty: true,
      include: [CourseModel]
    })
  ]);

  if (!klass.course.isTrial) {
    throw Boom.badRequest(
      'Only introductory class is available for express checkout',
      klass.details
    );
  }

  const enrollment = await EnrollmentModel.create({
    studentId: student.id,
    classId: klass.id,
    source: req.session.utmSource || '',
    campaign: req.session.utmCampaign || ''
  });

  logger.info(
    { type: 'ENROLL_CLASS', userId: student.parentId, classId: klass.id },
    '%s enrolled %s',
    student.name,
    klass.courseId
  );

  enrollment.student = student;
  enrollment.class = klass;

  await emitEnrollClassEvent([enrollment]);

  return enrollment;
}

export async function enrollClass(
  root: any,
  args: MutationArgs.EnrollClass,
  req: Request
) {
  if (!req.userId) {
    throw Boom.unauthorized('You must login first');
  }

  const [student, klasses] = await Promise.all([
    getStudent(args, req),
    ClassModel.findAll({
      include: [CourseModel],
      where: {
        id: {
          [Op.in]: args.classIds
        }
      }
    })
  ]);

  if (klasses.length === 0) {
    throw Boom.badRequest('invalid classIds', args);
  }

  if (args.credit > 0) {
    const balanceInCents = await student.parent.getBalanceInCents();
    if (args.credit > balanceInCents) {
      throw Boom.badRequest('you do not have enough credit', args);
    }
  }

  // find the lowest level course, highlevel ones are addons
  let mainKlass = klasses[0];
  if (klasses.length > 1) {
    for (const klass of klasses) {
      if (klass.course.level < mainKlass.course.level) {
        mainKlass = klass;
      }
    }
  }

  const evtLogger = logger.child({
    type: 'ENROLL_CLASS',
    userId: student.parentId
  });

  const isBundle = klasses.length > 1 && !args.wholeSeries;
  let priceInCents = getTotalPriceInCents(klasses, {
    wholeSeries: args.wholeSeries
  });

  let usedCredit: CreditModel = null;
  let appliedPromo: PromotionModel = null;

  const tx = await sequelize.transaction();
  const txOpts = { transaction: tx };

  try {
    // apply promotion first
    if (priceInCents > 0 && args.promotionId) {
      appliedPromo = await getPromotionIfQualified(
        args.promotionId,
        student.parent,
        mainKlass.course
      );

      if (!appliedPromo) {
        throw Boom.badRequest(`promotion ${args.promotionId} is not valid`);
      }

      await appliedPromo.increment('counts', txOpts);
      priceInCents = applyPromo(priceInCents, appliedPromo, {
        isBundle,
        wholeSeries: args.wholeSeries
      }).result;
      evtLogger.info('used coupon %s', appliedPromo.code);
    }

    // apply credit if there is any
    if (priceInCents > 0 && args.credit > 0) {
      const applied = applyCredit(priceInCents, args.credit);
      const creditDetails: CreditModel['details'] = {
        reason: `Purchase ${mainKlass.course.name}`,
        createdBy: 'webportal',
        attribution: {
          userId: req.userId,
          classId: mainKlass.id
        }
      };

      usedCredit = await CreditModel.create(
        {
          cents: -applied.used,
          userId: req.userId,
          type: CreditType.Purchase,
          details: creditDetails
        },
        txOpts
      );

      priceInCents = applied.result;
      evtLogger.info('used $%s credit', usedCredit.cents / 100);
    }

    if (mainKlass.course.isRegular && !student.parent.paid) {
      await student.parent.update({ paid: true }, txOpts);

      if (priceInCents > 0 && student.parent.refererId) {
        const creditDetails: CreditModel['details'] = {
          reason: `${student.parent.firstName} has purchased ${mainKlass.course.name}`,
          createdBy: 'firstPurchase',
          attribution: {
            classId: mainKlass.id,
            userId: student.parentId
          }
        };

        await CreditModel.create(
          {
            userId: student.parent.refererId,
            cents: ReferralCredits.purchase,
            type: CreditType.Referral,
            details: creditDetails
          },
          txOpts
        );
      }
    }

    const enrollments = await EnrollmentModel.bulkCreate(
      klasses.map(klass => ({
        studentId: student.id,
        classId: klass.id,
        source: req.session.utmSource || '',
        campaign: req.session.utmCampaign || '',
        promotionId: appliedPromo ? appliedPromo.id : null,
        creditId: usedCredit ? usedCredit.id : null
      })),
      txOpts
    );

    if (priceInCents > 0) {
      const transactionDetails = await sale(
        priceInCents / 100,
        args.paymentMethodNonce,
        args.classIds[0] + args.studentId
      );

      evtLogger.info({ transactionDetails });

      const saleRecord = await TransactionModel.create(
        { details: transactionDetails },
        txOpts
      );

      await saleRecord.addEnrollments(enrollments, txOpts);

      evtLogger.info('paid $%s', saleRecord.amount);
    }

    await tx.commit();

    await emitEnrollClassEvent(enrollments);

    return enrollments;
  } catch (err) {
    await tx.rollback();
    evtLogger.error(err, 'fail to enroll class');
    addBreadcrumb({ message: 'enroll class error' });
    throw err;
  }
}
