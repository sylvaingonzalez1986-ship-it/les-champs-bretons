import { Redirect } from 'expo-router';
import { useUserIdentity } from '@/lib/useAuth';

export default function Index() {
  const { role } = useUserIdentity();
  const homeRoute = role === 'client' ? '/(tabs)/marche-local' : '/(tabs)/map';

  return <Redirect href={homeRoute} />;
}
