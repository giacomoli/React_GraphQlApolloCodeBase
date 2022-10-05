import { useQuery } from '@apollo/react-hooks';
import {
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardMedia,
  Container,
  Divider,
  Grid,
  IconButton,
  LinearProgress,
  Typography
} from '@material-ui/core';
import { ArrowBackIos } from '@material-ui/icons';
import { captureException } from 'cl-sentry';
import { DateTime } from 'luxon';
import React from 'react';
import { useAlert } from 'react-alert';
import { preferenceFormUrl } from '../../../shared/constants';
import { QueryArgs } from '../../../types';
import {
  ClassListResult,
  GetUpcomingClassesQuery
} from '../../graphql/class-queries';
import {
  ClassLite,
  CourseWithSubject,
  UserWithChildren
} from '../../graphql/data-models';
import { logEvent } from '../../lib/analytics';
import GroupedClassListing from '../class-info/grouped-class-listing';
import ExternalLink from '../external-link';
import ExpressSignup from './express-signup';

interface Props {
  course: CourseWithSubject;
  onAccountCreated: (user: UserWithChildren) => void;
  onGoBack: () => void;
}

export default function SelectTrial({ course, onAccountCreated, onGoBack }: Props) {
  const alert = useAlert();
  const [selected, selectClass] = React.useState<ClassLite>(null);

  const queryResult = useQuery<ClassListResult, QueryArgs.Classes>(
    GetUpcomingClassesQuery,
    {
      variables: {
        courseId: course.id
      },
      onCompleted() {
        logEvent('ViewSchedule', {
          content_name: course.name,
          content_ids: [course.id],
          subject: course.subjectId
        });
      },
      onError(err) {
        captureException(err);
        alert.error('Unexpected error, please try again');
      }
    }
  );
  const klasses = queryResult.data && queryResult.data.classes;

  return (
    <Container maxWidth="md" style={{ marginBottom: 50 }}>
      <Box py={3} display="flex" flexDirection="row">
        <IconButton size="small" onClick={onGoBack}>
          <ArrowBackIos />
        </IconButton>
        <Box flexGrow={1}>
          <Typography variant="h6" align="center">
            {selected
              ? 'Enter Student Information to Enroll'
              : 'Check Schedule & Pick Session'}
          </Typography>
        </Box>
      </Box>
      <Grid container spacing={4}>
        <Grid item xs={12} sm={6}>
          <Card>
            <CardMedia
              image={course.thumbnail}
              style={{ height: 0, paddingTop: '62.5%' }}
            />
            <CardHeader
              title={course.name}
              subheader={`Grades ${course.grades.join('-')}`}
            />
            <Divider />
            <CardContent>{course.description}</CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6}>
          {selected ? (
            <>
              <Typography paragraph gutterBottom>
                We are reserving a spot for your child. Please enter the following
                information to confirm.
              </Typography>
              <Typography color="textPrimary" style={{ fontWeight: 'bolder' }}>
                {DateTime.fromISO(selected.startDate).toFormat('ffff')}
              </Typography>
              <Button
                color="secondary"
                size="small"
                variant="text"
                onClick={() => {
                  selectClass(null);
                  logEvent('ViewSchedule', {
                    content_name: course.name,
                    content_ids: [course.id],
                    subject: course.subjectId
                  });
                }}
              >
                (switch to a different time)
              </Button>
              <ExpressSignup
                klass={selected}
                course={course}
                onAccountCreated={onAccountCreated}
              />
            </>
          ) : klasses ? (
            <>
              <Typography variant="h6" color="textSecondary" gutterBottom>
                Please Select a Session
              </Typography>
              <GroupedClassListing
                course={course}
                klasses={klasses}
                handleSelect={klass => {
                  selectClass(klass);
                  logEvent('InitiateCheckout', {
                    content_name: course.name,
                    content_ids: [course.id],
                    subject: course.subjectId
                  });
                }}
              />
              <Box mt={2} textAlign="right">
                <ExternalLink color="secondary" href={preferenceFormUrl}>
                  Need a time that works better? Please tell us your preferences
                  here.
                </ExternalLink>
              </Box>
            </>
          ) : (
            <LinearProgress />
          )}
        </Grid>
      </Grid>
    </Container>
  );
}
