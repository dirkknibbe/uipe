import { DevSnippet } from "@/components/DevSnippet";
import { Footer } from "@/components/Footer";
import { Hero } from "@/components/Hero";
import { HowItWorks } from "@/components/HowItWorks";
import { Pricing } from "@/components/Pricing";
import { Problem } from "@/components/Problem";
import { Solution } from "@/components/Solution";

export default function Home() {
  return (
    <>
      <main>
        <Hero />
        <Problem />
        <Solution />
        <HowItWorks />
        <Pricing />
        <DevSnippet />
      </main>
      <Footer />
    </>
  );
}
