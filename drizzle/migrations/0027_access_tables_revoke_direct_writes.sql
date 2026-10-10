REVOKE ALL ON public.access_credentials FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.resellers, public.access_accounts, public.credit_transactions, public.credit_orders FROM anon, authenticated;
REVOKE ALL ON public.resellers, public.access_accounts, public.credit_transactions, public.credit_orders FROM anon;