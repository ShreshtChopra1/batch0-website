import Navbar from "@/components/navbar";
import Hero from "@/components/hero";
import HowItWorks from "@/components/how-it-works";
import Deliverables from "@/components/deliverables";
import Curriculum from "@/components/curriculum";
import Founder from "@/components/founder";
import Pricing from "@/components/pricing";
import FAQ from "@/components/faq";
import CTA from "@/components/cta";
import Footer from "@/components/footer";
import StickyMobileCta from "@/components/sticky-mobile-cta";
import { ChallengeMarquee } from "@/components/challenge-marquee";
import { ChallengeWinners } from "@/components/challenge-winners";
import { getPublicSiteConfig } from "@/lib/site-config";
import { getActiveChallenge, getPublicWinners } from "@/lib/challenges";
import { RegionalPrice } from "@/components/regional-price";

// Title/description inherit from the root layout; the canonical is set
// here (not in the layout) so child routes don't inherit "/".
export const metadata = { alternates: { canonical: "/" } };

// Prerendered with ISR — nothing here is per-visitor. The auth-dependent CTA
// resolves in the browser (/home + AuthLabel), and regional tuition, the last
// per-request input, is a client-side text swap: the pricing override table
// has exactly one country, so the server renders the base price and
// <RegionalPrice> corrects the label for visitors whose clock says India.
// Admin edits revalidate SITE_CONFIG_TAG and this path directly, so the
// 300s window is only the fallback horizon.
export const revalidate = 300;

export default async function Home() {
  const [config, regionalConfig, activeChallenge, winners] = await Promise.all([
    getPublicSiteConfig({ countryCode: null }),
    // The same cached data derived as an Indian visitor sees it — this is
    // where <RegionalPrice>'s swap target comes from, so the label always
    // matches what derive() would have produced server-side.
    getPublicSiteConfig({ countryCode: "IN" }),
    getActiveChallenge(),
    getPublicWinners(),
  ]);
  return (
    // The outer element is a plain <div>, not <main>. A <main> that contains
    // the navbar and the footer swallows their `banner` and `contentinfo`
    // landmarks, and it makes the "Skip to content" link land above the very
    // nav it is supposed to skip. <main> now wraps only the content, and
    // carries no layout classes of its own so nothing moves.
    <div className="min-h-screen bg-paper">
      <Navbar cohortLabel={config.derived.cohortLabel || "the next cohort"} />
      {activeChallenge && (
        <ChallengeMarquee
          challenge={{
            slug: activeChallenge.slug,
            title: activeChallenge.title,
            marqueeText: activeChallenge.marqueeText,
            prizeLabel: activeChallenge.prizeLabel,
            ctaLabel: activeChallenge.ctaLabel,
            ctaHref: activeChallenge.ctaHref,
          }}
        />
      )}
      <main id="main-content" tabIndex={-1}>
        <Hero config={config} />
        <HowItWorks config={config} />
        <Deliverables />
        <Founder contactEmail={config.settings.contactEmail} />
        <ChallengeWinners winners={winners} />
        <Pricing config={config} />
        <FAQ config={config} />
        <CTA config={config} />
      </main>
      <Footer config={config} />
      <StickyMobileCta config={config} />
      <RegionalPrice
        base={config.derived.priceLabel}
        regional={regionalConfig.derived.priceLabel}
      />
    </div>
  );
}
