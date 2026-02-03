-- Allow guest actors (no userId/agentId) when guestNickname/password exist.
ALTER TABLE "Actor" DROP CONSTRAINT IF EXISTS "Actor_one_owner_check";

ALTER TABLE "Actor"
  ADD CONSTRAINT "Actor_one_owner_check"
  CHECK (
    (("userId" IS NOT NULL) AND ("agentId" IS NULL)) OR
    (("userId" IS NULL) AND ("agentId" IS NOT NULL)) OR
    (("userId" IS NULL) AND ("agentId" IS NULL)
      AND ("guestNickname" IS NOT NULL) AND ("guestPasswordHash" IS NOT NULL))
  );
