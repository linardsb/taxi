import { redirect } from 'next/navigation';

/** The console IS the app — the root goes straight to the board. */
export default function Home() {
  redirect('/dispatch');
}
