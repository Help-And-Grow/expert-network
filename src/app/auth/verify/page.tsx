import Link from "next/link";

import { Mail } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function VerifyPage() {
  return (
    <div className="app-shell flex min-h-screen flex-col items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 text-center pb-4">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Mail className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">
            Check your email
          </CardTitle>
          <CardDescription className="text-base">
            We&apos;ve sent a magic link to your email. Click the link to sign
            in.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          <p className="text-center text-sm text-muted-foreground">
            The link will expire shortly. If you don&apos;t see it, check your
            spam folder.
          </p>
          <Button asChild variant="outline" className="w-full">
            <Link href="/auth/signin">Back to sign in</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
