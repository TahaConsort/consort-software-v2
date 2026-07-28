import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { LogOut } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { useAuthStore } from "@/store/authStore"

const AdminLogoutModal = () => {
  const navigate = useNavigate()

  const handleLogout = () => {
    useAuthStore.getState().logout()
    navigate("/")
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger className="w-full" asChild>
        <button
          className="
            w-full flex items-center gap-3 px-3 py-2
            text-sm rounded-md transition-all duration-200
            text-red-500
            hover:bg-red-100 hover:text-red-600
            dark:hover:bg-red-900/20
          "
        >
          <LogOut size={18} />
          Logout
        </button>
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Are you sure you want to logout?
          </AlertDialogTitle>
          <AlertDialogDescription>
            You will be signed out of your account and redirected to login.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel className="w-full sm:w-auto">
            Cancel
          </AlertDialogCancel>

          <AlertDialogAction
            onClick={handleLogout}
            className="
              w-full sm:w-auto
              bg-red-500 text-white
              hover:bg-red-600
              transition-colors
            "
          >
            Logout
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export default AdminLogoutModal