
CREATE OR REPLACE FUNCTION public.validate_director_relationship()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  _from_type text;
  _to_type text;
BEGIN
  IF NEW.relationship_type = 'director' THEN
    SELECT entity_type::text INTO _from_type FROM public.entities WHERE id = NEW.from_entity_id;
    SELECT entity_type::text INTO _to_type FROM public.entities WHERE id = NEW.to_entity_id;

    IF _from_type IS DISTINCT FROM 'Individual' OR _to_type IS DISTINCT FROM 'Company' THEN
      RAISE EXCEPTION 'Directors must be individuals and can only be linked to companies. Got: % -> %', _from_type, _to_type;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_director_relationship
  BEFORE INSERT OR UPDATE ON public.relationships
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_director_relationship();
