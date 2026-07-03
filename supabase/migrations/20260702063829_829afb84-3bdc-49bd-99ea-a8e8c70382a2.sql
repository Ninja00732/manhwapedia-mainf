
-- Fix discussions SELECT policy: hide soft-deleted from public, keep visible to mods/admins/author
DROP POLICY IF EXISTS "discussions readable" ON public.discussions;
CREATE POLICY "discussions readable" ON public.discussions FOR SELECT
USING (
  deleted_at IS NULL
  OR auth.uid() = author_id
  OR public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'moderator')
);

-- Add DELETE policy for discussions (authors + mods/admins)
CREATE POLICY "author or mods delete discussions" ON public.discussions FOR DELETE
USING (
  auth.uid() = author_id
  OR public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'moderator')
);
GRANT DELETE ON public.discussions TO authenticated;

-- Lock down user_roles: only admins can insert/update/delete; block privilege escalation
CREATE POLICY "admins insert roles" ON public.user_roles FOR INSERT
WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins update roles" ON public.user_roles FOR UPDATE
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins delete roles" ON public.user_roles FOR DELETE
USING (public.has_role(auth.uid(), 'admin'));

-- Revoke EXECUTE on SECURITY DEFINER trigger functions from client roles
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.snapshot_revision() FROM PUBLIC, anon, authenticated;
