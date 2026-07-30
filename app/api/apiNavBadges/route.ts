import { apiNavBadges } from '@/lib/api/navbadges';

export const dynamic = 'force-dynamic';

export async function POST() {
  const data = await apiNavBadges();
  return Response.json(data);
}
