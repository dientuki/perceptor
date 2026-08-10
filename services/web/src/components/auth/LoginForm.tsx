"use client";
import Checkbox from "@/components/form/input/Checkbox";
import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import Button from "@/components/ui/button/Button";
import { Eye, EyeOff } from 'lucide-react';
import Link from "next/link";
import { useState, useActionState } from "react";
import { loginAction } from "@/actions/auth";
import { useSearchParams } from "next/dist/client/components/navigation";

export default function LoginForm() {
  const [showPassword, setShowPassword] = useState(false);
  const [isChecked, setIsChecked] = useState(false);
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirect') || '/dashboard';

  // Enlazamos el argumento a la acción
  const loginWithRedirect = loginAction.bind(null, redirectTo);
  
  const [state, formAction, isPending] = useActionState(loginWithRedirect, null);


  return (
    <div className="flex flex-col flex-1 lg:w-1/2 w-full">
      <div className="flex flex-col justify-center flex-1 w-full max-w-md mx-auto">
        <div>
          <div className="mb-5 sm:mb-8">
            <h1 className="mb-2 font-semibold text-gray-800 text-title-sm dark:text-white/90 sm:text-title-md">
              Login
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Enter your username and password to log in!
            </p>
          </div>
          <div>
            <form action={formAction}>
              <div className="space-y-6">
                <div>
                  <Label>
                    Username <span className="text-error-500">*</span>{" "}
                  </Label>
                  <Input
                    name="username"
                    placeholder="admin"
                    type="text"
                    required
                  />
                </div>
                <div>
                  <Label>
                    Password <span className="text-error-500">*</span>{" "}
                  </Label>
                  <div className="relative">
                    <Input
                      name="password"
                      type={showPassword ? "text" : "password"}
                      placeholder="Enter your password"
                      required
                    />
                    <span
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute z-30 -translate-y-1/2 cursor-pointer right-4 top-1/2 w-5 h-5"
                    >
                      {showPassword ? (
                        <Eye className="fill-gray-500 dark:fill-gray-400" />
                      ) : (
                        <EyeOff className="fill-gray-500 dark:fill-gray-400" />
                      )}
                    </span>
                  </div>
                </div>

                {state?.error && (
                  <p className="text-sm text-error-500 bg-error-50 dark:bg-error-500/10 p-3 rounded-lg">
                    {state.error}
                  </p>
                )}

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Checkbox name="rememberMe" checked={isChecked} onChange={setIsChecked} />
                    <span className="block font-normal text-gray-700 text-theme-sm dark:text-gray-400">
                      Keep me logged in
                    </span>
                  </div>
                  <Link
                    href="/reset-password"
                    className="text-sm text-brand-500 hover:text-brand-600 dark:text-brand-400"
                  >
                    Forgot password?
                  </Link>
                </div>
                <div>
                  <Button type="submit" className="w-full" size="sm" disabled={isPending}>
                    {isPending ? "Logging in..." : "Log in"}
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}