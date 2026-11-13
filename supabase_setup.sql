-- ============================================================================
-- 지속가능한 미래를 위한 2050 로봇 박람회 - Supabase 초기 설정 SQL
-- ============================================================================
-- [사용 방법]
-- 1. Supabase 대시보드(https://supabase.com)에서 프로젝트 생성 후 좌측 메뉴 [SQL Editor] 클릭
-- 2. [+ New query]를 누르고 아래 SQL 전체를 붙여넣은 뒤 [Run] 버튼 클릭!
-- ============================================================================

-- 1. 학생 로봇 기획서 및 실시간 상태 저장 테이블 생성
create table if not exists public.robot_expo_students (
  student_id text primary key,
  student_name text not null,
  status text not null default 'drafting',
  inputs jsonb not null default '{}'::jsonb,
  video_prompt text not null default '',
  spec_sheet jsonb default null,
  teacher_feedback text not null default '',
  feedback_at text not null default '',
  video jsonb not null default '{"type":"none","url":"","title":""}'::jsonb,
  likes integer not null default 0,
  current_version integer not null default 0,
  history jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- 2. 학급 수업용 공개 읽기/쓰기 권한(RLS) 설정
alter table public.robot_expo_students enable row level security;

drop policy if exists "Allow public classroom access on robot_expo_students" on public.robot_expo_students;
create policy "Allow public classroom access on robot_expo_students"
  on public.robot_expo_students
  for all
  to anon, authenticated
  using (true)
  with check (true);

-- 3. 실시간 모니터링(Realtime) 활성화
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'robot_expo_students'
  ) then
    alter publication supabase_realtime add table public.robot_expo_students;
  end if;
end $$;

-- 4. 박람회 부스별 짧은 로봇 영상(MP4) 저장용 Storage 버킷 생성 (robot-videos)
insert into storage.buckets (id, name, public, file_size_limit)
values ('robot-videos', 'robot-videos', true, 52428800)
on conflict (id) do update
  set public = true,
      file_size_limit = 52428800;

-- 5. Storage 버킷(robot-videos) 공개 업로드/열람/수정 정책 설정
drop policy if exists "Allow public video access on robot-videos" on storage.objects;
create policy "Allow public video access on robot-videos"
  on storage.objects
  for all
  to anon, authenticated
  using (bucket_id = 'robot-videos')
  with check (bucket_id = 'robot-videos');
