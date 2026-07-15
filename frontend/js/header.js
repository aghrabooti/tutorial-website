async function loadHeader(){


    const container =
    document.getElementById("header");


    if(!container)
        return;



    const response =
    await fetch("/frontend/components/header.html");


    if(!response.ok){

        console.error(
            "Header failed:",
            response.status
        );

        return;

    }



    container.innerHTML =
    await response.text();



    updateActivePage();

    updateAuthButton();

    updateCartBadge();


}



function updateActivePage(){


const page =
document.body.dataset.page;



document
.querySelectorAll(".nav-link")
.forEach(link=>{


if(link.dataset.page===page){


link.classList.remove(
"text-gray-600"
);


link.classList.add(
"text-blue-600",
"font-bold"
);


}


});


}

async function loadHeader(){
    const container = document.getElementById("header");

    if(!container)
        return;

    const response = await fetch("components/header.html");

    if(!response.ok){
        console.error("Header failed:", response.status);
        return;
    }

    container.innerHTML = await response.text();

    updateActivePage();
    updateAuthButton();
    updateCartBadge();
}

function updateActivePage(){
    const page = document.body.id;
    document.querySelectorAll(".nav-link").forEach(link => {
        if(link.dataset.page === page){
            link.classList.remove("text-gray-600");
            link.classList.add("text-blue-600", "font-bold");
        }
    });
}

document.addEventListener("DOMContentLoaded", loadHeader);