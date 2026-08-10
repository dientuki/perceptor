import LoginForm from "@/components/auth/LoginForm";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Login | Perceptor",
  description: "Perceptor login page",
};

export default function Login() {
  return <LoginForm />;
}
