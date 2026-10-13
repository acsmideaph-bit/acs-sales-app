-- Template for supabase/seed/org_roster.sql (the real file is git-ignored
-- because it lists staff names and emails and the GitHub Pages repo is public).
insert into public.org_roster (email, full_name, position, role, team, area, supervisor_email) values
  ('director@company.com', 'Director Name', 'BU Director',            'director',     'BU',   'HQ',  null),
  ('head@company.com',     'Channel Head',  'Channel Head',           'channel_head', 'ACS',  'HQ',  'director@company.com'),
  ('rsm@company.com',      'RSM Name',      'Regional Sales Manager', 'rsm',          'NCR',  'NCR', 'head@company.com'),
  ('kam@company.com',      'KAM Name',      'Area Sales Engineer',    'kam',          'NCR',  'NCR', 'rsm@company.com')
on conflict (email) do update set full_name = excluded.full_name, position = excluded.position, role = excluded.role,
  team = excluded.team, area = excluded.area, supervisor_email = excluded.supervisor_email, updated_at = now();
