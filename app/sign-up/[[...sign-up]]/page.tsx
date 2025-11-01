import { SignUp } from "@clerk/nextjs";
export default function Page() {
	return (
		<SignUp
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