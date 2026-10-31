import Image from "next/image";
import type { Metadata } from "next";
import { Suspense } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LoginForm } from "@/components/LoginForm";

export const metadata: Metadata = {
  title: "Axtra - Login",
};

export default function LoginPage() {
  return (
    <main className="relative flex min-h-screen flex-col bg-background text-foreground">
      <div className="absolute right-4 top-4 z-10">
        <ThemeToggle />
      </div>

      <div className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="w-full max-w-[340px] text-center">
          <Image
            src="/axtratr.png"
            alt=""
            width={56}
            height={56}
            priority
            className="animate-welcome mx-auto h-14 w-14 rounded-xl"
          />

          <h1 className="font-brand mt-6 text-[26px] leading-tight font-semibold tracking-tight">
            <span className="block overflow-hidden pb-[0.14em]">
              <span className="animate-line block [animation-delay:200ms]">
                Selamat datang,
              </span>
            </span>
            <span className="block overflow-hidden pb-[0.14em]">
              <span className="animate-line block text-muted [animation-delay:480ms]">
                Owner Febry
              </span>
            </span>
          </h1>

          <div className="animate-welcome mt-9 [animation-delay:820ms]">
            <Suspense fallback={<div className="h-[100px]" aria-hidden />}>
              <LoginForm />
            </Suspense>
          </div>
        </div>
      </div>
    </main>
  );
}
