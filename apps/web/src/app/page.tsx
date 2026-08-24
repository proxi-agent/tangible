import { redirect } from 'next/navigation';

/**
 * The front door opens on the day's work, not the research wing.
 *
 * The market overview used to live here, which made the app greet a
 * practitioner with appraisal-roll analysis every morning. That page is the
 * market's front room now, at /market; the root sends the practitioner to the
 * season board — the one screen that says what crosses a deadline next.
 */
export default function Home() {
  redirect('/season');
}
