async function updateCartBadge(){
    const badge = document.getElementById("cart-count-badge");

    if(!badge)
        return;

    const token = localStorage.getItem("session_token");

    if(!token){
        badge.classList.add("hidden");
        return;
    }

    try{
        const result = await apiCall("get-cart", { token });
        const items = result.items || [];

        if(items.length > 0){
            badge.textContent = items.length;

            badge.className = ""; 

            badge.classList.add(
                "absolute",
                "-top-1.5",
                "-right-1.5",
                "bg-rose-500",
                "text-white",
                "text-[10px]",
                "font-black",
                "w-5",
                "h-5",
                "rounded-full",
                "flex",
                "items-center",
                "justify-center",
                "border-2",
                "border-white",
                "shadow-sm",
                "animate-pulse" 
            );
        }
        else {
            badge.classList.add("hidden");
        }
    }
    catch(error){
        console.error("cart badge:", error);
    }
}