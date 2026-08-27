import type { AssistantScope, AssistantSuggestion } from '@tangible/types';

/**
 * What to ask, offered rather than generated.
 *
 * The hardest thing about a surface that will answer anything is knowing what
 * it can be asked. A blank box teaches nobody the difference between a
 * question this record can settle and one it cannot, and a preparer who opens
 * it twice, gets "the record does not hold this" twice, and closes it, is
 * right to stop.
 *
 * So the starters are a static table keyed by route. Static because a list
 * that changes every render teaches nothing — the point is that the second
 * time you open the drawer on the findings screen, the same three questions
 * are there and you already know what they do. And keyed by route because the
 * question worth asking on a season board is a different question from the
 * one worth asking over the public roll, and the shell already knows which of
 * those the reader is standing on.
 *
 * Nothing here is scoped by id. A suggestion says "this client" and lets the
 * scope that travels with the question resolve it, which is also how a
 * preparer would say it out loud.
 */

interface StarterGroup {
  /** Route prefix this group belongs to. Longest match wins. */
  prefix: string;
  suggestions: AssistantSuggestion[];
}

/**
 * Order is the priority. First match wins, so the engagement tabs come before
 * the client prefix they hang under and the top-level routes come last: on a
 * findings screen the findings questions are the useful ones, not the client
 * ones, even though the path carries both.
 */
const GROUPS: readonly StarterGroup[] = [
  {
    prefix: '/findings',
    suggestions: [
      {
        label: 'What we found',
        question:
          'Summarize the findings on this engagement: what is claimed, how much cost each one takes off, and what still needs a decision.',
      },
      {
        label: 'Hardest to defend',
        question:
          'Which of these findings would be hardest to defend to the district, and what evidence would each one need?',
      },
      {
        label: 'Basis for a removal',
        question:
          'What is the statutory basis for taking real property and leased equipment off a personal property rendition?',
      },
    ],
  },
  {
    prefix: '/filing',
    suggestions: [
      {
        label: 'Ready to file',
        question:
          'Is this engagement ready to file at every site, and what is holding up the ones that are not?',
      },
      {
        label: 'Who signs',
        question: 'Who may sign this rendition, and when does Form 50-144 have to be notarized?',
      },
      {
        label: 'Deadline',
        question:
          'What is the rendition deadline for this engagement, and what would an extension move it to?',
      },
    ],
  },
  {
    prefix: '/report',
    suggestions: [
      {
        label: 'The headline',
        question:
          'What is the total overstatement on this register, and what is the estimated tax effect?',
      },
      {
        label: 'Where it comes from',
        question:
          'Which categories of asset account for most of the cost coming off this register?',
      },
      {
        label: 'Open questions',
        question:
          'Which findings on this engagement are screening questions the client still has to answer?',
      },
    ],
  },
  {
    prefix: '/clients/',
    suggestions: [
      {
        label: 'This client',
        question:
          'Give me the state of this client: their sites, their engagements, and what is outstanding on each.',
      },
      {
        label: 'Filing profile',
        question:
          'Is this client’s filing profile complete enough to record a return, and what is missing if not?',
      },
      {
        label: 'On the public roll',
        question:
          'What does the county’s public appraisal roll show for this client’s accounts, and how does it compare to what we hold?',
      },
    ],
  },
  {
    prefix: '/season',
    suggestions: [
      {
        label: 'What is blocked',
        question:
          'Which returns this season are blocked, what is blocking each one, and who has to do something about it?',
      },
      {
        label: 'Next deadline',
        question: 'Which deadline arrives next across the whole practice, and whose return is it?',
      },
      {
        label: 'Extensions',
        question:
          'Which sites have a rendition extension on file, and which ones should have asked for one by now?',
      },
    ],
  },
  {
    prefix: '/clients',
    suggestions: [
      {
        label: 'Where the work is',
        question:
          'Which clients have an engagement open this season, and how far along is each one?',
      },
      {
        label: 'Biggest exposure',
        question:
          'Across every client, which engagement has the largest identified overstatement on its register?',
      },
      {
        label: 'What is a rendition',
        question:
          'What is a rendition, who has to file one in Texas, and what happens if nobody does?',
      },
    ],
  },
  {
    prefix: '/market',
    suggestions: [
      {
        label: 'This county',
        question:
          'For the county I have selected, how much personal property value is on the roll and how much of it went unrendered?',
      },
      {
        label: 'Compare counties',
        question:
          'Which loaded county has the largest unrendered value, and how do the top few compare?',
      },
      {
        label: 'What this data is',
        question:
          'What does the public appraisal roll actually contain, and what can it never tell me about an account?',
      },
    ],
  },
  {
    prefix: '/accounts',
    suggestions: [
      {
        label: 'Largest non-filers',
        question:
          'In the selected county and year, which accounts with the largest assessed value did not render?',
      },
      {
        label: 'One account',
        question:
          'Walk me through an account’s history: its value by year and whether it rendered each year.',
      },
      {
        label: 'Penalty exposure',
        question:
          'What penalty does Texas apply to an account that fails to render, and can it be waived?',
      },
    ],
  },
  {
    prefix: '/owners',
    suggestions: [
      {
        label: 'Multi-site owners',
        question:
          'Which owners in the selected county hold the most accounts, and what is their combined assessed value?',
      },
      {
        label: 'Chronic non-filers',
        question:
          'Which owners have failed to render across several of their accounts in the selected year?',
      },
    ],
  },
  {
    prefix: '/data',
    suggestions: [
      {
        label: 'What is loaded',
        question:
          'Which counties have data loaded, for which years, and which of them publish a rendition flag?',
      },
      {
        label: 'What is missing',
        question:
          'Which jurisdictions can this product not answer questions about yet, and why not?',
      },
    ],
  },
];

/** Shown where the route matches nothing in particular, and on `/assistant`. */
const GENERAL: AssistantSuggestion[] = [
  {
    label: 'Across the practice',
    question: 'Which returns are blocked this season, and what is blocking each one?',
  },
  {
    label: 'A statutory question',
    question: 'What are the Tax Code 25.25 routes back into a closed year, and what bars each one?',
  },
  {
    label: 'The public roll',
    question:
      'Which counties have data loaded here, and what can the public roll tell me about an account?',
  },
  {
    label: 'How this works',
    question: 'What can I ask you, and what sources do your answers come from?',
  },
];

export function suggestionsFor(scope: AssistantScope | null): AssistantSuggestion[] {
  const path = scope?.path ?? '';
  if (!path || path === '/assistant') return GENERAL;

  const group = GROUPS.find((candidate) => path.includes(candidate.prefix));
  return group ? group.suggestions : GENERAL;
}
