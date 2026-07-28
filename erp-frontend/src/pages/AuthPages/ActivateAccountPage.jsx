import { useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Lock, Eye, EyeOff } from "lucide-react";
import toast from "react-hot-toast";
import AuthCardShell from "./AuthCardShell";
import { activate } from "@/services/authService";

export default function ActivateAccountPage() {
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
      await activate(token, password);
      toast.success("Account activated. You can sign in now.");
      navigate("/");
    } catch (err) {
      toast.error(err?.message || "Activation link is invalid or expired");
    } finally {
      setIsLoading(false);
    }
  };

  if (!token) {
    return (
      <AuthCardShell title="Activate account" subtitle="This link is missing its token.">
        <p className="text-sm text-center text-muted-foreground">
          Use the activation link from your invitation email.
        </p>
      </AuthCardShell>
    );
  }

  return (
    <AuthCardShell title="Activate account" subtitle="Set your password to get started">
      <form onSubmit={handleSubmit} className="space-y-5">
        {[
          { id: "password", label: "Password", value: password, set: setPassword },
          { id: "confirm", label: "Confirm password", value: confirm, set: setConfirm },
        ].map((f) => (
          <div key={f.id} className="space-y-2">
            <Label htmlFor={f.id} className="text-sm font-medium">
              {f.label}
            </Label>
            <div className="relative group">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
              <Input
                id={f.id}
                type={show ? "text" : "password"}
                placeholder="••••••••"
                value={f.value}
                autoComplete="new-password"
                onChange={(e) => f.set(e.target.value)}
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
        ))}

        <Button
          type="submit"
          disabled={isLoading}
          className="w-full h-11 rounded-lg text-sm font-medium disabled:opacity-70"
        >
          {isLoading ? "Activating…" : "Activate account"}
        </Button>
      </form>
    </AuthCardShell>
  );
}
