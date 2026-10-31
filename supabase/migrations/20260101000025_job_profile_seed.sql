-- AXTRA — seed profil kandidat owner (LinkedIn + portfolio).
--
-- Hanya mengisi kolom yang masih kosong, sehingga perubahan manual pengguna
-- tidak tertimpa bila migration dijalankan ulang di lingkungan lain.

insert into public.job_cv (user_id, linkedin_url, portfolio_url)
values (
    '00000000-0000-0000-0000-000000000001',
    'https://www.linkedin.com/in/mochammad-ginata-febryansyah-29708337a',
    'https://itzfebryhcx.my.id'
)
on conflict (user_id) do update set
    linkedin_url = case
        when public.job_cv.linkedin_url = '' then excluded.linkedin_url
        else public.job_cv.linkedin_url
    end,
    portfolio_url = case
        when public.job_cv.portfolio_url = '' then excluded.portfolio_url
        else public.job_cv.portfolio_url
    end,
    links_updated_at = now();