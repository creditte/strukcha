CREATE OR REPLACE FUNCTION public.validate_relationship_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _from_type text;
  _to_type text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT entity_type::text INTO _from_type FROM public.entities WHERE id = NEW.from_entity_id;
  SELECT entity_type::text INTO _to_type FROM public.entities WHERE id = NEW.to_entity_id;

  IF _from_type IS NULL OR _to_type IS NULL THEN
    RETURN NEW;
  END IF;

  -- Unknown type: accept. Judging a link against an unknown entity type used to
  -- reject valid Xero data (and abort the whole sync).
  IF _from_type = 'Unclassified' OR _to_type = 'Unclassified' THEN
    RETURN NEW;
  END IF;

  IF NOT public.rel_direction_valid(NEW.relationship_type::text, _from_type, _to_type) THEN
    RAISE EXCEPTION 'A % link is not valid between a % and a %.',
      NEW.relationship_type, _from_type, _to_type;
  END IF;

  RETURN NEW;
END;
$function$;