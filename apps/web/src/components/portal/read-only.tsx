'use client';

import { Eye } from 'lucide-react';
import { Callout } from '@/components/ui/primitives';
import { usePortal } from '@/components/portal/portal-context';

/**
 * What a viewer sees where an admin sees a control.
 *
 * The server already refuses these calls — `requirePortalRole('admin')` guards
 * the upload, the answers, and the question box, and that is the boundary that
 * actually holds. This is the other half: a control that is present, inviting,
 * and refused on click teaches a person that the product is broken rather than
 * that their account is limited. So the affordance is not disabled, it is
 * absent, and this stands in its place saying why and what to do about it.
 *
 * It names no email address. Who can grant the role is a fact about the
 * client's own organisation, and guessing at it — "ask your controller" — is
 * how a portal ends up telling a controller to ask themselves.
 */
export function ReadOnlyNote({ what }: { what: string }) {
  return (
    <Callout tone="neutral" icon={Eye} title="Your access here is read-only">
      You can see everything on this page. {what} needs an account with permission to act — ask
      whoever set up your access to give you that.
    </Callout>
  );
}

/**
 * True when this reader may send files and answer questions.
 *
 * A thin wrapper over the portal context so a component gating one control does
 * not have to destructure the whole scope, and so there is one name to grep for
 * when the role list grows past two.
 */
export function useCanAct(): boolean {
  return usePortal().canAct;
}
