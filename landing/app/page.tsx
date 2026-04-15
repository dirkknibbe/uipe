import { Hero } from "@/components/Hero";
import { HowItWorks } from "@/components/HowItWorks";
import { Problem } from "@/components/Problem";
import { Solution } from "@/components/Solution";

export default function Home() {
  return (
    <main>
      <Hero />
      <Problem />
      <Solution />
      <HowItWorks />
    </main>
  );
}
