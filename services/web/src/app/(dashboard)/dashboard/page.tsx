import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get('token')?.value;

  async function handleLogout() {
    'use server';
    const cookieStore = await cookies();
    cookieStore.delete('token');
    redirect('/login');
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <header className="flex items-center justify-between border-b border-gray-800 pb-4">
          <h1 className="text-2xl font-bold">Dashboard Protegido</h1>
          <form action={handleLogout}>
            <button
              type="submit"
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium hover:bg-red-500 transition-colors"
            >
              Cerrar Sesión
            </button>
          </form>
        </header>

        <main className="space-y-4">
          <div className="rounded-xl bg-gray-900 border border-gray-800 p-6 space-y-2">
            <h2 className="text-lg font-semibold text-emerald-400">✓ Acceso Autorizado</h2>
            <p className="text-sm text-gray-400">
              Estás viendo esta página porque el middleware validó la presencia de tu token JWT.
            </p>
          </div>

          <div className="rounded-xl bg-gray-900 border border-gray-800 p-6">
            <h3 className="text-sm font-medium text-gray-400 mb-2">Token en Cookie:</h3>
            <pre className="overflow-x-auto rounded bg-gray-950 p-3 text-xs text-mono text-blue-400 border border-gray-800">
              {token || 'No se encontró token'}
            </pre>
          </div>
        </main>
      </div>
    </div>
  );
}