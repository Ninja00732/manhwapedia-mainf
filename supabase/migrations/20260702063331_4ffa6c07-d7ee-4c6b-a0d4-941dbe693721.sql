
-- Real covers from AniList
UPDATE public.wiki_pages SET cover_url='https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx128882-UxgmKbYEjuEz.jpg' WHERE slug='jungle-juice';
UPDATE public.wiki_pages SET cover_url='https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx163824-KiablxybJD6i.jpg' WHERE slug='baskerville-bloodhound';
UPDATE public.wiki_pages SET cover_url='https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx140475-QEGtrmdvbpOv.jpg' WHERE slug='fragrant-flower';

-- Restrict edits: only the page author or admins/moderators can edit
DROP POLICY IF EXISTS "auth users edit pages" ON public.wiki_pages;
CREATE POLICY "author or mods edit pages" ON public.wiki_pages
  FOR UPDATE TO authenticated
  USING (
    auth.uid() = created_by
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'moderator')
  )
  WITH CHECK (
    auth.uid() = created_by
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'moderator')
  );
