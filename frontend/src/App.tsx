import { useAuthStore } from "@/stores/authStore";
import LoginPage from "@/components/Layout/LoginPage";
import MainLayout from "@/components/Layout/MainLayout";

export default function App() {
  const { isAuthenticated } = useAuthStore();

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return <MainLayout />;
}
