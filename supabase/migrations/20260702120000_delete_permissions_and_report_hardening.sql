DROP POLICY IF EXISTS "mods delete pages" ON public.wiki_pages;
CREATE POLICY "owners or admins delete pages" ON public.wiki_pages
FOR DELETE USING (
  auth.uid() = created_by OR public.has_role(auth.uid(), 'admin')
);

DROP POLICY IF EXISTS "author or mods edit discussions" ON public.discussions;
CREATE POLICY "author or admins edit discussions" ON public.discussions
FOR UPDATE USING (
  auth.uid() = author_id OR public.has_role(auth.uid(), 'admin')
);

CREATE UNIQUE INDEX IF NOT EXISTS reports_one_open_per_user_page_idx
ON public.reports (page_id, reporter_id)
WHERE status = 'open';
