import { runPrisma } from './reporting-seed';

/**
 * Database reads for the credential-rotation suite (story #347, QA task #387).
 *
 * ADR 0016 §5 makes "existing credentials are never displayed" a property of
 * the data model: there is no API surface anywhere that returns a
 * `passwordHash` or a `pinHash`, so the only way to assert *which* credential a
 * rotation actually rewrote is to read the two columns directly.
 *
 * That matters for the half of the story that a positive sign-in cannot prove.
 * "Update the password without changing the PIN" is satisfied on the wire by
 * two facts — the new password works and the old PIN still works — but a
 * successful PIN sign-in only shows the stored PIN hash still verifies the old
 * PIN; it does not show the column was left alone (a re-hash of the same PIN
 * would pass too, and would be a real §6 violation). Comparing the stored hash
 * strings before and after does show it, because argon2id salts every hash: a
 * rewrite always produces a different string, even for identical input.
 *
 * The same asymmetry is why the refusal tests read here. "A refused update
 * changes nothing" is a negative, and the endpoint's own response cannot
 * witness it.
 */

export interface StoredCredentials {
  passwordHash: string;
  pinHash: string | null;
}

/** The two hash columns, as stored, for the account linked to a roster member. */
export function readStoredCredentials(staffMemberId: string): StoredCredentials {
  const output = runPrisma(`
    const member = await prisma.staffMember.findUnique({
      where: { id: ${JSON.stringify(staffMemberId)} },
      select: { user: { select: { passwordHash: true, pinHash: true } } },
    });
    process.stdout.write(JSON.stringify(member && member.user ? member.user : null));
  `);
  const stored = JSON.parse(output) as StoredCredentials | null;
  if (!stored) {
    throw new Error(`No linked account for staff member ${staffMemberId}`);
  }
  return stored;
}

/** The same two columns addressed by account id, for an unlinked account. */
export function readStoredCredentialsByUserId(userId: string): StoredCredentials {
  const output = runPrisma(`
    const user = await prisma.user.findUnique({
      where: { id: ${JSON.stringify(userId)} },
      select: { passwordHash: true, pinHash: true },
    });
    process.stdout.write(JSON.stringify(user));
  `);
  const stored = JSON.parse(output) as StoredCredentials | null;
  if (!stored) throw new Error(`No account ${userId}`);
  return stored;
}
