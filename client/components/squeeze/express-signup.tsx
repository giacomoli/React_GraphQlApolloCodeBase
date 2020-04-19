import { useMutation } from '@apollo/react-hooks';
import { Box, Grid, Typography } from '@material-ui/core';
import { Topic } from 'cl-common';
import React from 'react';
import { routeIds } from '../../../shared/constants';
import { MutationArgs } from '../../../types';
import { AccountContext } from '../../context/account';
import { DeeplinkContext } from '../../context/deeplink';
import { transformGraphqlError } from '../../graphql/apollo';
import { ClassLite, Course, UserWithChildren } from '../../graphql/data-models';
import { SignUpMutation, UserChildrenResponse } from '../../graphql/user-queries';
import { logEvent } from '../../lib/analytics';
import { hasMetBirthdayRequirement } from '../../lib/class-time-helper';
import {
  birthYearProps,
  childNameProps,
  emailProps,
  nameProps,
  passwordProps
} from '../../lib/input-fields';
import CLButton from '../cl-button';
import CLTextInput from '../cl-text-input';
import NextMUILink from '../next-mui-link';

interface Props {
  klass: ClassLite;
  course: Course;
  onAccountCreated: (user: UserWithChildren) => void;
}

export default function ExpressSignup(props: Props) {
  const account = React.useContext(AccountContext);
  const deeplink = React.useContext(DeeplinkContext);

  const [email, setEmail] = React.useState(deeplink.email);
  const [name, setName] = React.useState(deeplink.name);
  const [childName, setChildName] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [year, setYear] = React.useState<number>();
  const [errors, setErrors] = React.useState({});

  const [handleSignup, signupResult] = useMutation<
    UserChildrenResponse,
    MutationArgs.SignUp
  >(SignUpMutation, {
    onError(err) {
      setErrors(transformGraphqlError(err).details);
    },
    onCompleted(data) {
      account.setUser(data.user);
      logEvent('StartTrial', {
        content_name: props.course.name,
        content_ids: [props.course.id],
        content_type: 'product',
        subject: props.course.subjectId,
        variant: 'Express Signup',
        value: 0
      });
      props.onAccountCreated(data.user);
    }
  });

  const isScratch = props.course.subjectId === Topic.SN;
  const isTooYoung = !hasMetBirthdayRequirement(year, props.course);
  const disabled = isTooYoung && !isScratch;

  return (
    <form
      onSubmit={evt => {
        evt.preventDefault();

        return handleSignup({
          variables: {
            classId: props.klass.id,
            timezone: account.localZone,
            password,
            name,
            email,
            year,
            childName
          }
        });
      }}
    >
      <Grid container spacing={2}>
        <Grid item xs={12} sm={6}>
          <CLTextInput
            {...childNameProps}
            required
            value={childName}
            errors={errors}
            onChange={evt => setChildName(evt.target.value)}
          />
        </Grid>
        <Grid item xs={12} sm={6}>
          <CLTextInput
            {...birthYearProps}
            value={year}
            errors={errors}
            onChange={evt => setYear(parseInt(evt.target.value, 10))}
          />
        </Grid>
        <Grid item xs={12} sm={6}>
          <CLTextInput
            {...emailProps}
            required
            helperText="We will email you about how to join the class"
            value={email}
            errors={errors}
            onChange={evt => setEmail(evt.target.value)}
          />
        </Grid>
        <Grid item xs={12} sm={6}>
          <CLTextInput
            {...passwordProps}
            required
            value={password}
            errors={errors}
            onChange={evt => setPassword(evt.target.value)}
          />
        </Grid>
        {deeplink.name ? null : (
          <Grid item xs={12} md={6}>
            <CLTextInput
              {...nameProps}
              required
              value={name}
              errors={errors}
              onChange={evt => setName(evt.target.value)}
            />
          </Grid>
        )}
      </Grid>
      {isTooYoung && (
        <Box mb={2}>
          <Typography variant="subtitle2" color="error">
            This class is best for student grade {props.course.grades[0]} and above.
            {isScratch
              ? 'You will need to attend the class together with your kid if you would like to register.'
              : 'We recommend signing up for Scratch Ninja class instead.'}
          </Typography>
        </Box>
      )}
      <Box my={2}>
        <CLButton
          color="primary"
          variant="contained"
          fullWidth
          loading={signupResult.loading}
          disabled={disabled}
        >
          Enroll for Free
        </CLButton>
        <Typography variant="caption">
          {"By signing up, you accept Create & Learn's "}
          <NextMUILink next={{ href: routeIds.tos }} color="secondary">
            Terms of Service
          </NextMUILink>
          {' and '}
          <NextMUILink next={{ href: routeIds.privacy }} color="secondary">
            Privacy Policy
          </NextMUILink>
          .
        </Typography>
      </Box>
    </form>
  );
}
