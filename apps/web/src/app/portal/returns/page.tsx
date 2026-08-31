'use client';

import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Circle, FileText, Gavel, Landmark } from 'lucide-react';
import type { ClientFilingStatement, ClientReturn } from '@tangible/types';
import { api } from '@/lib/api';
import { count, day, dayShort, moneyExact, plural } from '@/lib/format';
import { usePortal } from '@/components/portal/portal-context';
import { PortalHeader } from '@/components/portal/portal-header';
import {
  Badge,
  Callout,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Skeleton,
  Stat,
  StatCell,
  StatGrid,
} from '@/components/ui/primitives';
import { InfoTip } from '@/components/ui/tooltip';
import { LinkButton } from '@/components/ui/controls';

/**
 * Is my return going out on time.
 *
 * The third of the four questions this wing exists to answer, and the last of
 * them to get a page: a business could read what we thought their property was
 * worth and could not find out whether anything had been filed for them, what
 * the district said back, or which date falls next.
 *
 * Three rules, and they are the same rule in three places.
 *
 * A return that has not gone out says exactly that and nothing else. There is
 * no "on track", no readiness verdict, no green tick standing in for a promise —
 * the page prints the operative date and how long is left and lets the reader
 * draw their own conclusion. The firm's board has a readiness verdict, and it is
 * our opinion of our own record: it flips when somebody fills in a field, and a
 * client watching it flip would learn only that we are busy.
 *
 * Nothing unfiled carries a value. What a draft would say today is a working
 * number, and putting it in the same column as a figure actually sworn to would
 * make two different kinds of claim look alike.
 *
 * The clocks are printed even when they are bad news, and especially then. The
 * 22.30(b) waiver window runs thirty days from the notice with no May 15 floor
 * under it, so it is routinely the first to close and the one nobody is
 * watching; a business that can see it can ring us about it.
 */
export default function PortalReturnsPage() {
  const { engagementId, href } = usePortal();
  const query = useQuery({
    queryKey: ['portal-returns', engagementId],
    queryFn: () => api.returnsStatement(engagementId!),
    enabled: engagementId !== null,
  });

  if (engagementId === null) {
    return (
      <>
        <PortalHeader title="Your return" description="Nothing has been opened for you yet." />
        <Card>
          <EmptyState title="No tax year open">
            Once we open a year for you, your returns and their deadlines appear here.
          </EmptyState>
        </Card>
      </>
    );
  }

  const statement = query.data;

  return (
    <>
      <PortalHeader
        title="Your return"
        description="What has to be filed for you, by when, and what the district said back."
      />

      {query.isLoading ? (
        <Card>
          <div className="space-y-3 px-5 py-5">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-40 w-full" />
          </div>
        </Card>
      ) : query.error ? (
        <Card>
          <ErrorState error={query.error} />
        </Card>
      ) : !statement || statement.returns.length === 0 ? (
        <Card>
          <EmptyState
            title="No return is set up yet"
            action={<LinkButton href={href('/portal/documents')}>Send us your register</LinkButton>}
          >
            A rendition is filed per business location. Once we know where your property sits, each
            location and its deadline appear here.
          </EmptyState>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader
              title={`${statement.taxYear} filing season`}
              description={summarize(statement)}
            />
            <Season statement={statement} />
          </Card>

          {statement.returns.map((entry) => (
            <Return key={entry.locationId} entry={entry} />
          ))}

          {statement.unplacedCount > 0 ? (
            <Callout tone="neutral" title="Property not yet on any return">
              {count(statement.unplacedCount)} {plural(statement.unplacedCount, 'item')} on your
              register, {moneyExact(statement.unplacedCost)} at cost, is not yet assigned to one of
              your locations, so it is not counted in any return above. Where we need you to tell us
              which location it belongs to, the question is on your{' '}
              <span className="whitespace-nowrap">Questions page</span>.
            </Callout>
          ) : null}
        </>
      )}
    </>
  );
}

function summarize(statement: ClientFilingStatement): string {
  const total = statement.returns.length;
  const filed = statement.returns.filter((entry) => entry.filed !== null).length;
  const noun = plural(total, 'return');
  if (total === 0) return 'No returns owed.';
  if (filed === total) return `All ${count(total)} ${noun} filed.`;
  if (filed === 0) return `${count(total)} ${noun} to file.`;
  return `${count(filed)} of ${count(total)} ${noun} filed.`;
}

/**
 * The year's own dates, above the per-return ones.
 *
 * Both April 15 and May 15 are printed because an extension is per account: a
 * row reading May means nothing to a reader who cannot see it started as April,
 * and somebody with one extended site and one not would otherwise conclude we
 * had the date wrong on one of them.
 */
function Season({ statement }: { statement: ClientFilingStatement }) {
  const soonest = statement.returns
    .filter((entry) => entry.filed === null)
    .reduce<ClientReturn | null>(
      (best, entry) => (best === null || entry.daysToDue < best.daysToDue ? entry : best),
      null,
    );

  return (
    <StatGrid columns={3}>
      <StatCell className="px-5 py-4">
        <Stat
          label="Rendition deadline"
          value={day(statement.statutoryDueOn)}
          note={`${dayShort(statement.extendedDueOn)} on a written request`}
          help="Tax Code 22.23 sets April 15 for the rendition. A written request that reaches the chief appraiser before that date moves it to May 15 — the district does not have to agree, and the extension is per account rather than per business."
        />
      </StatCell>
      <StatCell className="px-5 py-4">
        <Stat
          label="Next return due"
          value={soonest === null ? 'Nothing outstanding' : day(soonest.dueOn)}
          note={soonest === null ? 'every return filed' : soonest.label}
          tone={soonest !== null && soonest.daysToDue < 0 ? 'critical' : 'default'}
          help="The earliest date any unfiled return of yours is working to, after any extension already in force for that location."
        />
      </StatCell>
      <StatCell className="px-5 py-4">
        <Stat
          label="Locations"
          value={count(statement.returns.length)}
          note="one return each"
          help="A rendition is filed per account, and an account belongs to a location. Two sites in the same county are still two returns."
        />
      </StatCell>
    </StatGrid>
  );
}

/**
 * One location's return, as the chain it actually is: what we filed, what the
 * district answered, how it ended. A step that has not happened is drawn empty
 * rather than hidden, because the shape of what is still to come is half of
 * what a reader came here for.
 */
function Return({ entry }: { entry: ClientReturn }) {
  return (
    <Card>
      <CardHeader
        title={entry.label}
        icon={Landmark}
        description={[
          entry.districtName,
          entry.accountId ? `Account ${entry.accountId}` : 'No account number yet',
        ]
          .filter(Boolean)
          .join(' · ')}
        action={<Standing entry={entry} />}
      />
      <div className="divide-y divide-[var(--color-hairline)]">
        <Step
          icon={FileText}
          done={entry.filed !== null}
          title={entry.filed === null ? 'Not filed yet' : 'Filed'}
          detail={<Filed entry={entry} />}
        />
        <Step
          icon={Landmark}
          done={entry.notice !== null}
          title={entry.notice === null ? "The district's answer" : 'The district answered'}
          detail={<Noticed entry={entry} />}
        />
        <Step
          icon={Gavel}
          done={entry.resolution !== null}
          title={entry.resolution === null ? 'Protest' : 'Settled'}
          detail={<Protest entry={entry} />}
        />
      </div>
    </Card>
  );
}

/**
 * The one badge on the row, and it reports a document or a date rather than a
 * verdict. "Filed", "Settled", "due in nine days" are all things a business
 * could confirm without us. A readiness word would not be.
 */
function Standing({ entry }: { entry: ClientReturn }) {
  if (entry.resolution !== null) return <Badge tone="good">Settled</Badge>;
  if (entry.notice?.protestFiledOn) return <Badge tone="accent">Protest filed</Badge>;
  if (entry.notice !== null) return <Badge tone="accent">Notice received</Badge>;
  if (entry.filed !== null) return <Badge tone="good">Filed</Badge>;
  if (entry.daysToDue < 0) return <Badge tone="critical">Past the deadline</Badge>;
  if (entry.daysToDue <= 14) {
    return (
      <Badge tone="warning">{`Due in ${count(entry.daysToDue)} ${plural(entry.daysToDue, 'day')}`}</Badge>
    );
  }
  return <Badge tone="neutral">Not filed yet</Badge>;
}

function Filed({ entry }: { entry: ClientReturn }) {
  const filed = entry.filed;
  if (filed === null) {
    return (
      <>
        <p>
          Due {day(entry.dueOn)}
          {entry.daysToDue >= 0
            ? ` — ${count(entry.daysToDue)} ${plural(entry.daysToDue, 'day')} from today.`
            : ` — ${count(Math.abs(entry.daysToDue))} ${plural(Math.abs(entry.daysToDue), 'day')} ago.`}
        </p>
        <ExtensionLine entry={entry} />
      </>
    );
  }
  return (
    <>
      <p>
        {day(filed.filedOn)}, {METHOD_LABEL[filed.method] ?? filed.method}
        {filed.filedByAgent ? ', signed by us as your agent' : ', signed by you'}.
        {filed.confirmation ? ` Confirmation ${filed.confirmation}.` : ''}
      </p>
      <p className="text-[var(--color-ink-muted)]">
        {moneyExact(filed.totalHistoricalCost)} of property at original cost, covering{' '}
        {count(filed.assetCount)} {plural(filed.assetCount, 'item')}.{' '}
        <InfoTip
          title="What was filed"
          content="The figures on the form that went out, frozen as they were on the day it was filed. If your register has changed since, this does not move with it — the district is working from what it received."
          size={12}
        />
      </p>
      <ExtensionLine entry={entry} />
    </>
  );
}

/**
 * 22.23(b) has two sentences and they do different things. A request that
 * arrives in time moves the date on its own; the district's answer, where there
 * is one, is a confirmation rather than the thing that made it true. The line
 * says which of the two it is looking at.
 */
function ExtensionLine({ entry }: { entry: ClientReturn }) {
  if (entry.extension === null) return null;
  const extension = entry.extension;
  return (
    <p className="text-[var(--color-ink-muted)]">
      Extended from {dayShort(entry.statutoryDueOn)} to {day(extension.extendedTo)}, on a request
      sent {dayShort(extension.requestedOn)}
      {extension.answeredOn === null
        ? '. A request that arrives before the deadline moves it whether or not the district writes back.'
        : `, granted ${dayShort(extension.answeredOn)}.`}
    </p>
  );
}

function Noticed({ entry }: { entry: ClientReturn }) {
  const notice = entry.notice;
  if (notice === null) {
    return (
      <p className="text-[var(--color-ink-muted)]">
        {entry.filed === null
          ? // Not "waiting on the district" — it is not yet their turn, and
            // saying otherwise would put the delay on the wrong party.
            'The district appraises the account after the return goes in.'
          : 'Nothing has arrived yet. Personal property notices go out by May 1 under Tax Code 25.19.'}
      </p>
    );
  }
  return (
    <>
      <p>
        {day(notice.noticedOn)} — appraised at {moneyExact(notice.appraisedValue)}
        {notice.priorYearValue !== null
          ? `, against ${moneyExact(notice.priorYearValue)} last year.`
          : '.'}
      </p>
      {notice.renditionPenaltyApplied ? (
        <p className="text-[var(--color-critical)]">
          The notice adds the 10% late-rendition penalty under Tax Code 22.28.
          {notice.waiverDeadline
            ? ` A written request to waive it is due ${day(notice.waiverDeadline)} — thirty days from the notice, which is a shorter clock than the protest.`
            : ''}
        </p>
      ) : null}
    </>
  );
}

function Protest({ entry }: { entry: ClientReturn }) {
  const resolution = entry.resolution;
  if (resolution !== null) {
    return (
      <>
        <p>
          {STAGE_LABEL[resolution.stage] ?? resolution.stage} on {day(resolution.resolvedOn)}
          {resolution.finalValue !== null
            ? ` — value set at ${moneyExact(resolution.finalValue)}`
            : ' — no value was determined'}
          {resolution.noticedValue !== null && resolution.finalValue !== null
            ? `, from ${moneyExact(resolution.noticedValue)} on the notice.`
            : '.'}
        </p>
        {resolution.penaltyOutcome ? (
          <p className="text-[var(--color-ink-muted)]">
            {/* A won protest and a waived penalty are separate outcomes: the
                penalty survives a value reduction unless it is asked about. */}
            The rendition penalty was {resolution.penaltyOutcome === 'waived' ? 'waived' : 'upheld'}
            .
          </p>
        ) : null}
      </>
    );
  }
  const notice = entry.notice;
  if (notice === null) {
    return (
      <p className="text-[var(--color-ink-muted)]">
        A protest is filed against a notice, so this opens once one arrives.
      </p>
    );
  }
  if (notice.protestFiledOn !== null) {
    return (
      <p>
        Filed {day(notice.protestFiledOn)}. It sits with the district until they set an informal
        meeting or an ARB hearing.
      </p>
    );
  }
  return (
    <p className={notice.protestOpen ? undefined : 'text-[var(--color-ink-muted)]'}>
      {notice.protestOpen
        ? `Open until ${day(notice.protestDeadline)}.`
        : `The window closed ${day(notice.protestDeadline)}.`}{' '}
      <InfoTip
        title="The protest deadline"
        content="Tax Code 41.44 gives the later of May 15 and thirty days from delivery of the notice. Where the notice itself printed an earlier date, we work to that one."
        size={12}
      />
    </p>
  );
}

/**
 * A step is done or it is not. There is no third state, because the third state
 * would be our estimate of how it is going.
 */
function Step({
  icon: Icon,
  done,
  title,
  detail,
}: {
  icon: typeof FileText;
  done: boolean;
  title: string;
  detail: ReactNode;
}) {
  return (
    <div className="flex gap-3 px-5 py-4">
      <div className="mt-0.5 shrink-0">
        {done ? (
          <CheckCircle2 size={15} className="text-[var(--color-good)]" aria-hidden />
        ) : (
          <Circle size={15} className="text-[var(--color-ink-muted)]" aria-hidden />
        )}
      </div>
      <div className="min-w-0 space-y-1 text-xs">
        <p className="flex items-center gap-1.5 font-medium text-[var(--color-ink)]">
          <Icon size={13} className="text-[var(--color-ink-muted)]" aria-hidden />
          {title}
        </p>
        <div className="space-y-1 leading-relaxed text-[var(--color-ink-secondary)]">{detail}</div>
      </div>
    </div>
  );
}

/** The record's vocabulary, in the words a taxpayer would use for it. */
const METHOD_LABEL: Record<string, string> = {
  'certified-mail': 'sent by certified mail',
  mail: 'sent by mail',
  efile: "filed through the district's online system",
  email: 'sent by email',
  'hand-delivered': 'hand delivered to the district',
};

const STAGE_LABEL: Record<string, string> = {
  informal: 'Agreed informally with the appraiser',
  arb: 'Decided by the appraisal review board',
  withdrawn: 'Protest withdrawn',
  dismissed: 'Protest dismissed',
};
