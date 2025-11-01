import { SignIn } from "@clerk/nextjs";
export default function Page() {
	return (
		<SignIn
			appearance={{
				elements: {
					footer: "hidden",
					cardFooter: "hidden",
					footerAction: "hidden",
					footerActionText: "hidden",
					footerActionLink: "hidden",
					poweredBy: "hidden",
					footerPoweredBy: "hidden",
				},
			}}
		/>
	);
}
