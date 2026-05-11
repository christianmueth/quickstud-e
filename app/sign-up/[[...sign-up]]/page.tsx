import Link from "next/link";

export default function Page() {
	return (
		<main className="mx-auto flex min-h-[calc(100vh-64px)] max-w-5xl items-center gap-10 px-6 py-12">
			<section className="max-w-xl space-y-4">
				<p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Get started</p>
				<h1 className="text-4xl font-semibold tracking-tight text-slate-950">Create an account and start building your study routine.</h1>
				<p className="text-sm leading-7 text-slate-600">
					Once you sign up, QuickStud-E can start tracking your learning spaces, tutor guidance, and recovery progress.
				</p>
			</section>
			<div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
				<div className="space-y-4 rounded-2xl border border-slate-100 bg-slate-50 p-6">
					<h2 className="text-xl font-semibold text-slate-950">Start your study routine</h2>
					<p className="text-sm leading-6 text-slate-600">
						Use the sign-up button in the site header or on the home page to create your account, then come back to build your first learning space.
					</p>
					<Link href="/" className="inline-flex rounded-full bg-slate-950 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800">
						Return home
					</Link>
					<p className="text-xs leading-5 text-slate-500">The stable account-creation entry point currently lives on the home page.</p>
				</div>
			</div>
		</main>
	);
}