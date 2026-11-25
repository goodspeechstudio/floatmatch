-- Float Match database setup
-- Paste this whole file into Supabase > SQL Editor and click Run.
-- Change the host PIN on the last line first.

create table if not exists game (
  id int primary key default 1 check (id = 1),
  performers jsonb not null default '[]',
  floats jsonb not null default '[]',
  reveals jsonb not null default '{}',
  locked boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists host_secret (
  id int primary key default 1 check (id = 1),
  pin text not null
);

create table if not exists cards (
  id uuid primary key default gen_random_uuid(),
  token text unique not null,
  name text not null check (char_length(name) between 1 and 40),
  picks jsonb not null default '{}',
  submitted_at timestamptz not null default now()
);

alter table game enable row level security;
alter table host_secret enable row level security;
alter table cards enable row level security;

-- Everyone can read the game. Nobody writes tables directly; the functions below do it.
drop policy if exists "read game" on game;
create policy "read game" on game for select using (true);
grant select on game to anon, authenticated;

-- Public view of cards that hides each player's private token.
create or replace view public_cards as
  select id, name, picks, submitted_at from cards;
grant select on public_cards to anon, authenticated;

create or replace function submit_card(p_token text, p_name text, p_picks jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if (select locked from game where id = 1) then raise exception 'Picks are locked'; end if;
  if char_length(coalesce(p_token, '')) < 20 then raise exception 'Bad token'; end if;
  if char_length(trim(coalesce(p_name, ''))) = 0 then raise exception 'Name required'; end if;
  insert into cards (token, name, picks) values (p_token, left(trim(p_name), 40), p_picks)
  on conflict (token) do update set name = excluded.name, picks = excluded.picks, submitted_at = now()
  returning id into v_id;
  return v_id;
end $$;

create or replace function host_check(p_pin text)
returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from host_secret where id = 1 and pin = p_pin);
$$;

create or replace function host_save(p_pin text, p_game jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not host_check(p_pin) then raise exception 'Wrong PIN'; end if;
  update game set
    performers = coalesce(p_game->'performers', '[]'),
    floats = coalesce(p_game->'floats', '[]'),
    reveals = coalesce(p_game->'reveals', '{}'),
    locked = coalesce((p_game->>'locked')::boolean, false),
    updated_at = now()
  where id = 1;
end $$;

create or replace function host_delete_card(p_pin text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not host_check(p_pin) then raise exception 'Wrong PIN'; end if;
  delete from cards where id = p_id;
end $$;

revoke all on function submit_card(text, text, jsonb), host_check(text), host_save(text, jsonb), host_delete_card(text, uuid) from public;
grant execute on function submit_card(text, text, jsonb), host_check(text), host_save(text, jsonb), host_delete_card(text, uuid) to anon, authenticated;

insert into game (id, performers, floats) values (1,
  '[{"id":"queen-latifah","name":"Queen Latifah"},{"id":"megan-moroney","name":"Megan Moroney"},{"id":"teddy-swims","name":"Teddy Swims"},{"id":"keke-palmer","name":"Keke Palmer"},{"id":"jimmy-fallon-the-roots","name":"Jimmy Fallon & The Roots"},{"id":"smash-mouth","name":"Smash Mouth"},{"id":"baha-men","name":"Baha Men"},{"id":"natasha-bedingfield","name":"Natasha Bedingfield"},{"id":"blues-traveler","name":"Blues Traveler"},{"id":"devo","name":"DEVO"}]',
  '[{"id":"hogwarts-holiday","name":"Hogwarts Holiday (HBO)"},{"id":"dashing-all-the-way","name":"Dashing All the Way (DoorDash)"},{"id":"road-trip-to-parade","name":"Road Trip to Parade (GEICO)"},{"id":"mr-peanut-power-plant","name":"Mr. Peanut''s Power Plant (Planters)"},{"id":"purina-service-dogs","name":"Salute to Service Dogs (Purina Dog Chow)"},{"id":"macys-parade-all-stars","name":"Macy''s Parade All-Stars"},{"id":"tony-sarg-marionettes","name":"Tony Sarg''s Amazing Marionettes"},{"id":"disney-cruise","name":"Magic Meets the Seas (Disney Cruise Line)"},{"id":"tom-turkey","name":"Tom Turkey"},{"id":"sesame-street","name":"1-2-3 Sesame Street"}]'
) on conflict (id) do nothing;

-- CHANGE THIS PIN before running. You'll type it at floatmatch.goodspeech.studio/#host
insert into host_secret (id, pin) values (1, 'CHANGE-ME')
on conflict (id) do update set pin = excluded.pin;
