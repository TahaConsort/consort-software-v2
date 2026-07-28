import { useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Lock, Eye, EyeOff } from "lucide-react";
import toast from "react-hot-toast";
import AuthCardShell from "./AuthCardShell";
import { resetPassword } from "@/services/authService";

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password !== confirm) return toast.error("Passwords do not match");
    if (password.length < 8) return toast.error("Password must be at least 8 characters");

    setIsLoading(true);
    try {
      await resetPassword(token, password);
      toast.success("Password reset. Please sign in.");
      navigate("/");
    } catch (err) {
      toast.error(err?.message || "Reset link is invalid or expired");
    } finally {
      setIsLoading(false);
    }
  };

  if (!token) {
    return (
      <AuthCardShell title="Reset password" subtitle="This link is missing its token.">
        <p className="text-sm text-center text-muted-foreground">
          Request a fresh link from the forgot-password page.
        </p>
      </AuthCardShell>
    );
  }

  return (
    <AuthCardShell title="Reset password" subtitle="Choose a new password">
      <form onSubmit={handleSubmit} className="space-y-5">
        <PasswordField
          id="password"
          label="New password"
          value={password}
          onChange={setPassword}
          show={show}
          setShow={setShow}
        />
        <PasswordField
          id="confirm"
          label="Confirm password"
          value={confirm}
          onChange={setConfirm}
          show={show}
          setShow={setShow}
        />
        <Button
          type="submit"
          disabled={isLoading}
          className="w-full h-11 rounded-lg text-sm font-medium disabled:opacity-70"
        >
          {isLoading ? "Saving…" : "Reset password"}
        </Button>
      </form>
    </AuthCardShell>
  );
}

function PasswordField({ id, label, value, onChange, show, setShow }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-sm font-medium">
        {label}
      </Label>
      <div className="relative group">
        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
        <Input
          id={id}
          type={show ? "text" : "password"}
          placeholder="••••••••"
          value={value}
          autoComplete="new-password"
          onChange={(e) => onChange(e.target.value)}
          className="pl-10 pr-10 h-11 rounded-lg border border-gray-400 focus-visible:ring-2 focus-visible:ring-primary/20"
          required
        />
        <button
          type="button"
          onClick={() => setShow(!show)}
          aria-label={show ? "Hide password" : "Show password"}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary transition"
        >
          {show ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
    </div>
  );
}
