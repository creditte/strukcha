-- Rulebook v1 · Phase 1 · NOT APPLIED. See docs/relationship-policy.md.
-- Must run on its own: a new enum value cannot be used in the same transaction.
-- Additive and safe: no existing row changes.
ALTER TYPE public.relationship_type ADD VALUE IF NOT EXISTS 'trades_as';
