import {navigationArea} from '@/lib/navigation-area';
import { authClient } from "@/lib/auth-client";
import { SearchCommand } from "@/components/dashboard/search-command";
import { translateText } from "@/components/i18n-zh/translate";
import Head from "next/head";
import { useRouter } from "next/router";
import { useEffect } from "react";
import { api } from "@/utils/api";
import { useWhitelabeling } from "@/utils/hooks/use-whitelabeling";
import { ImpersonationBar } from "../dashboard/impersonation/impersonation-bar";
import { HubSpotWidget } from "../shared/HubSpotWidget";
import Page from "./side";

interface Props {
	children: React.ReactNode;
	metaName?: string;
}

export const DashboardLayout = ({ children, metaName }: Props) => {
	const router = useRouter();
 const {data:actor}=api.user.get.useQuery();
 const simplified=!!actor&&actor.role!=='owner'&&actor.role!=='admin'&&(router.pathname==='/dashboard/projects'||router.pathname.startsWith('/dashboard/project/'));
 useEffect(()=>{if(simplified)void router.replace('/dashboard/home');},[simplified,router]);
 const {data:loginSession,isPending:checkingLogin}=authClient.useSession();
 useEffect(()=>{if(!checkingLogin&&!loginSession)void router.replace("/");},[checkingLogin,loginSession,router]);
	const { data: haveRootAccess } = api.user.haveRootAccess.useQuery();
	const { data: isCloud } = api.settings.isCloud.useQuery();
	const { config: whitelabeling } = useWhitelabeling();
	const appName = whitelabeling?.appName || "AppHub";
	const { data: currentPlan } = api.stripe.getCurrentPlan.useQuery(undefined, {
		enabled: isCloud === true,
		refetchOnWindowFocus: false,
		refetchOnMount: false,
		refetchOnReconnect: false,
	});

	const isChatEnabled = isCloud === true && currentPlan === "startup";

	const { data: onboardingStatus } = api.project.onboardingStatus.useQuery();
	const shouldRedirectToOnboarding =
		router.pathname !== "/dashboard/home" &&
		onboardingStatus?.shouldShowOnboarding === true;

	useEffect(() => {
		if (loginSession && shouldRedirectToOnboarding) {
			router.replace("/dashboard/home");
		}
	}, [shouldRedirectToOnboarding, router, loginSession]);

	if (!loginSession || shouldRedirectToOnboarding || simplified) {
		return null;
	}

	return (
		<>
			{metaName && (
				<Head>
					<title>
						{translateText(metaName)} | {appName}
					</title>
				</Head>
			)}
			{navigationArea(actor?.role,router.pathname,router.query)==='operations'&&<SearchCommand/>}<Page>{children}</Page>
			{isChatEnabled && (
				<>
					<HubSpotWidget />
				</>
			)}

			{haveRootAccess === true && <ImpersonationBar />}
		</>
	);
};
