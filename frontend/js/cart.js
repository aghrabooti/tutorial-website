document.addEventListener("DOMContentLoaded", async ()=>{

    const token =
    localStorage.getItem("session_token");

    const authBtn =
    document.getElementById("auth-btn");

    if(!token){

        if(authBtn){

            authBtn.textContent =
            "ورود / ثبت‌نام";

            authBtn.href =
            "login.html";

        }

        return;

    }

    try{

        const result =
        await apiCall(
            "check-session",
            {
                token
            }
        );

        if(!result.valid){

            localStorage.removeItem(
                "session_token"
            );

            authBtn.textContent =
            "ورود / ثبت‌نام";

            authBtn.href =
            "login.html";

            return;

        }

        authBtn.textContent =
        "داشبورد من";

        authBtn.href =
        "dashboard.html";



        const cart =
        await apiCall(
            "get-cart",
            {
                token
            }
        );

        renderCart(cart.items || []);

    }
    catch(error){

        console.error(error);

    }

});


function renderCart(items){

    const container =
    document.getElementById("cart-items");

    let total = 0;

    if(items.length===0){

        container.innerHTML=`

        <div class="bg-white border border-gray-200 rounded-2xl p-12 text-center">

            <div class="w-24 h-24 mx-auto rounded-full bg-gray-50 flex items-center justify-center">

                <i class="fa-solid fa-cart-shopping text-4xl text-gray-300"></i>

            </div>

            <h2 class="text-xl font-bold mt-5">
            سبد خرید شما خالی است
            </h2>

            <p class="text-gray-400 mt-2">
            هنوز دوره‌ای اضافه نکرده‌اید.
            </p>

        </div>

        `;

        return;

    }

    container.innerHTML="";

    items.forEach(item=>{

        const course=item.courses;

        total+=Number(course.price);

        container.innerHTML+=`

        <div class="bg-white border border-gray-200 rounded-2xl p-5 flex gap-5">

            <img
            src="${course.image_url}"
            class="w-40 h-24 rounded-xl object-cover">

            <div class="flex-1">

                <h3 class="font-black text-lg">
                ${course.title}
                </h3>

                <p class="text-sm text-gray-500 mt-2">
                ${course.description??""}
                </p>

            </div>

            <div class="flex flex-col items-end justify-between">

                <span class="text-indigo-600 font-black">

                ${Number(course.price).toLocaleString("fa-IR")} تومان

                </span>

                <button
                    onclick="removeFromCart('${item.id}')"
                    class="text-red-500 hover:text-red-700 text-sm font-bold">

                    حذف

                </button>

            </div>

        </div>

        `;

    });

    document.getElementById("cart-total").textContent =
    total.toLocaleString("fa-IR")+" تومان";

    document.getElementById("final-total").textContent =
    total.toLocaleString("fa-IR");

}

async function removeFromCart(cartItemId){

    const token =
    localStorage.getItem("session_token");


    if(!token){
        return;
    }


    try{


        const result =
        await apiCall(
            "remove-from-cart",
            {
                token,
                cart_item_id: cartItemId
            }
        );


        console.log("REMOVE RESULT:", result);



        if(!result.success){

            alert(result.error);
            return;

        }



        location.reload();


    }
    catch(error){

        console.error(error);

        alert("خطا در حذف از سبد خرید");

    }

}