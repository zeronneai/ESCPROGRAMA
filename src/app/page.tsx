import { redirect } from "next/navigation";

// El middleware redirige segun rol; esto cubre el caso sin middleware.
export default function Home() {
  redirect("/login");
}
