import { LoginForm } from '@/components/LoginForm';

export const metadata = { title: 'Sign in · Zindagi Counsellor' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ expired?: string }> }) {
  const sp = await searchParams;
  return <LoginForm expired={sp.expired === '1'} />;
}
