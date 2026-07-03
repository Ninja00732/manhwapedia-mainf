
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
CREATE TYPE public.page_type AS ENUM ('series', 'character', 'lore');
CREATE TYPE public.series_status AS ENUM ('ongoing', 'completed', 'hiatus', 'cancelled', 'unknown');
CREATE TYPE public.report_status AS ENUM ('open', 'resolved', 'dismissed');

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  bio TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.profiles TO anon, authenticated;
GRANT INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles readable by all" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "users update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "users insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read own roles" ON public.user_roles FOR SELECT USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  uname TEXT;
BEGIN
  uname := COALESCE(
    NEW.raw_user_meta_data->>'username',
    split_part(NEW.email, '@', 1),
    'user_' || substr(NEW.id::text, 1, 8)
  );
  WHILE EXISTS (SELECT 1 FROM public.profiles WHERE username = uname) LOOP
    uname := uname || '_' || substr(gen_random_uuid()::text, 1, 4);
  END LOOP;
  INSERT INTO public.profiles (id, username, display_name)
  VALUES (NEW.id, uname, COALESCE(NEW.raw_user_meta_data->>'display_name', uname));
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TABLE public.tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'tag'
);
GRANT SELECT ON public.tags TO anon, authenticated;
GRANT INSERT ON public.tags TO authenticated;
GRANT ALL ON public.tags TO service_role;
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tags readable by all" ON public.tags FOR SELECT USING (true);
CREATE POLICY "auth users create tags" ON public.tags FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE TABLE public.wiki_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  type page_type NOT NULL,
  title TEXT NOT NULL,
  cover_url TEXT,
  infobox JSONB NOT NULL DEFAULT '{}'::jsonb,
  content_md TEXT NOT NULL DEFAULT '',
  status series_status,
  parent_slug TEXT,
  view_count INT NOT NULL DEFAULT 0,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE INDEX wiki_pages_type_idx ON public.wiki_pages(type);
CREATE INDEX wiki_pages_parent_idx ON public.wiki_pages(parent_slug);
CREATE INDEX wiki_pages_updated_idx ON public.wiki_pages(updated_at DESC);
CREATE INDEX wiki_pages_title_trgm ON public.wiki_pages USING gin (title public.gin_trgm_ops);

GRANT SELECT ON public.wiki_pages TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.wiki_pages TO authenticated;
GRANT ALL ON public.wiki_pages TO service_role;
ALTER TABLE public.wiki_pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pages readable by all" ON public.wiki_pages FOR SELECT USING (true);
CREATE POLICY "auth users create pages" ON public.wiki_pages FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "auth users edit pages" ON public.wiki_pages FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "mods delete pages" ON public.wiki_pages FOR DELETE
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'moderator'));

CREATE TABLE public.page_tags (
  page_id UUID NOT NULL REFERENCES public.wiki_pages(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  PRIMARY KEY (page_id, tag_id)
);
GRANT SELECT ON public.page_tags TO anon, authenticated;
GRANT INSERT, DELETE ON public.page_tags TO authenticated;
GRANT ALL ON public.page_tags TO service_role;
ALTER TABLE public.page_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "page_tags readable" ON public.page_tags FOR SELECT USING (true);
CREATE POLICY "auth manage page_tags" ON public.page_tags FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "auth remove page_tags" ON public.page_tags FOR DELETE USING (auth.uid() IS NOT NULL);

CREATE TABLE public.revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID NOT NULL REFERENCES public.wiki_pages(id) ON DELETE CASCADE,
  editor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  cover_url TEXT,
  infobox JSONB NOT NULL DEFAULT '{}'::jsonb,
  content_md TEXT NOT NULL DEFAULT '',
  status series_status,
  parent_slug TEXT,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX revisions_page_idx ON public.revisions(page_id, created_at DESC);
CREATE INDEX revisions_editor_idx ON public.revisions(editor_id, created_at DESC);
GRANT SELECT ON public.revisions TO anon, authenticated;
GRANT INSERT ON public.revisions TO authenticated;
GRANT ALL ON public.revisions TO service_role;
ALTER TABLE public.revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "revisions readable" ON public.revisions FOR SELECT USING (true);
CREATE POLICY "auth insert revisions" ON public.revisions FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE OR REPLACE FUNCTION public.snapshot_revision()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.revisions (page_id, editor_id, title, cover_url, infobox, content_md, status, parent_slug, comment)
  VALUES (NEW.id, COALESCE(NEW.updated_by, NEW.created_by), NEW.title, NEW.cover_url,
    NEW.infobox, NEW.content_md, NEW.status, NEW.parent_slug,
    CASE WHEN TG_OP = 'INSERT' THEN 'Página criada' ELSE NULL END);
  RETURN NEW;
END;
$$;
CREATE TRIGGER wiki_pages_snapshot AFTER INSERT OR UPDATE ON public.wiki_pages
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_revision();

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER wiki_pages_touch BEFORE UPDATE ON public.wiki_pages
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.discussions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID NOT NULL REFERENCES public.wiki_pages(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES public.discussions(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX discussions_page_idx ON public.discussions(page_id, created_at);
GRANT SELECT ON public.discussions TO anon, authenticated;
GRANT INSERT, UPDATE ON public.discussions TO authenticated;
GRANT ALL ON public.discussions TO service_role;
ALTER TABLE public.discussions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "discussions readable" ON public.discussions FOR SELECT USING (true);
CREATE POLICY "auth post discussions" ON public.discussions FOR INSERT WITH CHECK (auth.uid() = author_id);
CREATE POLICY "author or mods edit discussions" ON public.discussions FOR UPDATE
  USING (auth.uid() = author_id OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'moderator'));

CREATE TABLE public.watchlist (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  page_id UUID NOT NULL REFERENCES public.wiki_pages(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, page_id)
);
GRANT SELECT, INSERT, DELETE ON public.watchlist TO authenticated;
GRANT ALL ON public.watchlist TO service_role;
ALTER TABLE public.watchlist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own watchlist read" ON public.watchlist FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own watchlist insert" ON public.watchlist FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own watchlist delete" ON public.watchlist FOR DELETE USING (auth.uid() = user_id);

CREATE TABLE public.reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID REFERENCES public.wiki_pages(id) ON DELETE CASCADE,
  revision_id UUID REFERENCES public.revisions(id) ON DELETE SET NULL,
  discussion_id UUID REFERENCES public.discussions(id) ON DELETE CASCADE,
  reporter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status report_status NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.reports TO authenticated;
GRANT ALL ON public.reports TO service_role;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own reports read" ON public.reports FOR SELECT USING (
  auth.uid() = reporter_id OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'moderator'));
CREATE POLICY "auth create reports" ON public.reports FOR INSERT WITH CHECK (auth.uid() = reporter_id);
CREATE POLICY "mods update reports" ON public.reports FOR UPDATE USING (
  public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'moderator'));
