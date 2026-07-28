import { useState } from "react";
import { Link } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Mail, ArrowRight } from "lucide-react";
import toast from "react-hot-toast";
import AuthCardShell from "./AuthCardShell";
import { forgotPassword } from "@/services/authService";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const res = await forgotPassword(email);
      setSent(true);
      // In dev the backend returns a token so the flow is testable without email.
      if (res.devResetToken) {
        toast.success("Dev reset link ready — check below");
      } else {
        toast.success("If that email exists, a reset link has been sent.");
      }
      if (res.devResetToken) setSent(res.devResetToken);
    } catch (err) {
      toast.error(err?.message || "Something went wrong");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthCardShell
      title="Forgot password"
      subtitle="Enter your email and we'll send a reset link"
    >
      {sent ? (
        <div className="space-y-4 text-center">
          <p className="text-sm">
            If that email exists, a reset link has been sent. Follow it to choose a
            new password.
          </p>
          {typeof sent === "string" && (
            <Link
              to={`/reset-password?token=${encodeURIComponent(sent)}`}
              className="inline-block text-primary hover:underline text-sm break-all"
            >
              Dev: open reset link →
            </Link>
          )}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="email" className="text-sm font-medium">
              Email
            </Label>
            <div className="relative group">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                autoComplete="email"
                onChange={(e) => setEmail(e.target.value)}
                className="pl-10 h-11 rounded-lg border border-gray-400 focus-visible:ring-2 focus-visible:ring-primary/20"
                required
              />
            </div>
          </div>

          <Button
            type="submit"
            disabled={isLoading}
            className="w-full h-11 rounded-lg flex items-center justify-center gap-2 text-sm font-medium disabled:opacity-70"
          >
            {isLoading ? "Sending…" : "Send reset link"}
            <ArrowRight className="w-4 h-4" />
          </Button>
        </form>
      )}
    </AuthCardShell>
  );
}
