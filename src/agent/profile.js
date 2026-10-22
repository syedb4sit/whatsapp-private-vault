/**
 * Personal profile and hardcoded schedule context for Basit.
 * Injected into Gemini reasoning engine for contextual intelligence.
 */
export const BASIT_PROFILE = {
  name: 'Basit',
  title: 'Mr. Basit',
  routine: {
    office: {
      schedule: 'Every day (Monday to Sunday)',
      departure: '5:00 PM – 5:15 PM',
      arrivalHome: '1:00 AM – 1:30 AM',
      summary: 'Goes to office every day at 5:00–5:15 PM; returns home around 1:00–1:30 AM.',
    },
    university: {
      days: ['Monday', 'Tuesday', 'Wednesday'],
      classes: '8:30/9:00 AM to 3:00/4:00 PM',
      actualDeparture: 'Leaves university for home around 1:00 PM every day.',
      summary: 'University is 3 days a week (Monday, Tuesday, Wednesday). Always leaves for home around 1:00 PM.',
    },
    exams: {
      status: 'University exams are imminent.',
      firstExam: 'First exam is this upcoming Monday.',
      summary: 'Exams starting very soon; first exam is on Monday. Study and revision reminders should be treated with priority.',
    },
  },
};
