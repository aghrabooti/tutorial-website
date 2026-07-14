const supabaseClient = supabase.createClient(
    "https://qbsfotperzzhuimnpmto.supabase.co",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFic2ZvdHBlcnp6aHVpbW5wbXRvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3MTM2NzIsImV4cCI6MjA5OTI4OTY3Mn0.N8Pv0hz3yKLcTVvwfiRlKW-yEE-d4vc1rkroZBglyTA"
);



let allCourses = [];


let currentFilters = {

    productType:"course",

    grade:"all",

    major:"all"

};





async function checkUserSession(){


    const authBtn =
    document.getElementById("auth-btn");



    if(!authBtn)
        return;



    const token =
    localStorage.getItem("session_token");



    if(!token){


        authBtn.textContent =
        "ورود / ثبت‌نام";


        authBtn.href =
        "login.html";


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



        console.log(
            "session result:",
            result
        );




        if(result.valid){


            authBtn.textContent =
            "پنل کاربری";


            authBtn.href =
            "dashboard.html";


        }
        else{


            localStorage.removeItem(
                "session_token"
            );


            authBtn.textContent =
            "ورود / ثبت‌نام";


            authBtn.href =
            "login.html";


        }



    }
    catch(error){


        console.error(
            error
        );


    }


}







async function loadCourses(){



    await checkUserSession();




    const container =
    document.getElementById(
        "products-container"
    );



    if(!container)
        return;




    container.innerHTML =
    `
    <p class="text-center py-20 text-gray-500">
    در حال بارگذاری محصولات...
    </p>
    `;




    const {
        data,
        error
    } =
    await supabaseClient
    .from("courses")
    .select("*");





    if(error){


        console.error(error);


        container.innerHTML =
        `
        <p class="text-red-500 text-center py-20">
        خطا در دریافت محصولات
        </p>
        `;


        return;

    }





    allCourses =
    data || [];



    applyFilters();






    document
    .getElementById("grade-filter")
    ?.addEventListener(
        "change",
        e=>{


            currentFilters.grade =
            e.target.value;



            const fieldWrapper =
            document.getElementById(
                "field-filter-wrapper"
            );


            const fieldSelect =
            document.getElementById(
                "field-filter"
            );




            if(
                currentFilters.grade==="9" ||
                currentFilters.grade==="10"
            ){


                fieldWrapper.style.opacity="0.5";


                fieldSelect.disabled=true;


                currentFilters.major="all";


                fieldSelect.value="all";


            }
            else{


                fieldWrapper.style.opacity="1";


                fieldSelect.disabled=false;


            }



            applyFilters();


        }
    );







    document
    .getElementById("field-filter")
    ?.addEventListener(
        "change",
        e=>{


            currentFilters.major =
            e.target.value;


            applyFilters();


        }
    );









    document
    .querySelectorAll(".type-btn")
    .forEach(btn=>{


        btn.addEventListener(
            "click",
            ()=>{


                document
                .querySelectorAll(".type-btn")
                .forEach(b=>{


                    b.classList.remove(
                        "bg-indigo-600",
                        "text-white"
                    );


                    b.classList.add(
                        "bg-gray-100",
                        "text-gray-600"
                    );


                });



                btn.classList.remove(
                    "bg-gray-100",
                    "text-gray-600"
                );


                btn.classList.add(
                    "bg-indigo-600",
                    "text-white"
                );



                currentFilters.productType =
                btn.dataset.type;



                applyFilters();


            }
        );


    });



}









function applyFilters(){


    let filtered =
    allCourses;




    filtered =
    filtered.filter(c=>{


        const type =
        c.product_type || "course";


        const grade =
        String(c.grade || "");


        const major =
        c.major || "";




        const typeMatch =
        currentFilters.productType===type;



        const gradeMatch =
        currentFilters.grade==="all" ||
        currentFilters.grade===grade;



        let majorMatch=true;



        if(
            currentFilters.grade!=="9" &&
            currentFilters.grade!=="10"
        ){


            majorMatch =
            currentFilters.major==="all" ||
            currentFilters.major===major;


        }



        return (
            typeMatch &&
            gradeMatch &&
            majorMatch
        );

    });




    renderCourses(filtered);


}









function renderCourses(list){


    const container =
    document.getElementById(
        "products-container"
    );



    if(!container)
        return;




    if(list.length===0){


        container.innerHTML =
        `
        <p class="text-gray-500 text-center py-20 col-span-full">
        محصولی یافت نشد
        </p>
        `;


        return;

    }






    container.innerHTML =
    list.map(course=>{


        const image =
        course.image_url ||
        "https://placehold.co/400x225?text=No+Image";



        return `

        <div class="bg-white rounded-2xl border shadow-sm overflow-hidden">

            <img 
            src="${image}"
            class="w-full h-48 object-cover">


            <div class="p-6">


                <h3 class="font-bold text-xl">
                    ${course.title || "بدون نام"}
                </h3>



                <p class="text-gray-500 mt-3">
                    ${course.description || ""}
                </p>



                <div class="mt-5 flex justify-between items-center">


                    <span class="text-indigo-600 font-bold">

                    ${
                    Number(course.price || 0)
                    .toLocaleString("fa-IR")
                    }

                    تومان

                    </span>



                    <a 
                    href="courses-detail.html?id=${course.id}"
                    class="bg-indigo-600 text-white px-4 py-2 rounded-xl">

                    مشاهده

                    </a>


                </div>


            </div>

        </div>

        `;


    }).join("");

}









document.addEventListener(
"DOMContentLoaded",
()=>{


    loadCourses();


});

function initMobileMenu(){


    const btn =
    document.getElementById(
        "menu-toggle-btn"
    );


    const menu =
    document.getElementById(
        "mobile-menu"
    );



    if(!btn || !menu)
        return;



    btn.addEventListener(
        "click",
        ()=>{

            menu.classList.toggle(
                "hidden"
            );

        }
    );

}



document.addEventListener(
"DOMContentLoaded",
()=>{

    initMobileMenu();

});