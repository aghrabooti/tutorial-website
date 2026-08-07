const token =
localStorage.getItem("session_token");


const container =
document.getElementById("courses-list");


let currentCourses = [];



async function loadCourses(){


if(!token){

window.location.href="login.html";
return;

}


try{


const result =
await apiCall(
"admin-get-courses",
{
token
}
);



if(!result.success){

container.innerHTML =
`
<div class="text-red-500 font-bold">
${result.error}
</div>
`;

return;

}



renderCourses(result.courses);



}
catch(error){

console.error(error);


container.innerHTML =
`
<div class="text-red-500">
خطا در دریافت محتوا
</div>
`;


}


}





function renderCourses(courses){


currentCourses = courses;


if(courses.length===0){

container.innerHTML =
`
<div class="bg-white p-8 rounded-xl">

محتوایی وجود ندارد

</div>
`;

return;

}



container.innerHTML="";



courses.forEach(course=>{


let typeText =
course.type==="course"
?
"دوره"
:
course.type==="lecture"
?
"جزوه"
:
"کتاب";



container.innerHTML +=
`

<div class="bg-white border rounded-2xl p-5 flex gap-5">


<img
src="${course.image_url || ''}"
class="w-32 h-20 rounded-xl object-cover">



<div class="flex-1">


<h3 class="font-black text-lg">

${course.title}

</h3>



<span class="inline-block mt-2 bg-gray-100 px-3 py-1 rounded-full text-xs">

${typeText}

</span>



<p class="text-gray-500 text-sm mt-3">

${course.description || ""}

</p>


<div class="mt-3 text-indigo-600 font-bold">

${course.price ? 
Number(course.price).toLocaleString("fa-IR")+" تومان"
:
"رایگان"}

</div>



</div>



<button

onclick="editCourse('${course.id}')"

class="
bg-indigo-600
text-white
px-5
py-2
rounded-xl
h-fit">

ویرایش

</button>


</div>

`;

});


}






function createCourse(){


clearForm();


openEditModal();


}





function clearForm(){


document.getElementById("edit-course-id").value="";


document.getElementById("edit-title").value="";

document.getElementById("edit-description").value="";

document.getElementById("edit-price").value="";

document.getElementById("edit-discount").value="";

document.getElementById("edit-grade").value="";

document.getElementById("edit-major").value="";

document.getElementById("edit-category").value="";

document.getElementById("edit-type").value="course";

document.getElementById("edit-image").value="";


}





function editCourse(id){


const course =
currentCourses.find(
c=>c.id===id
);



if(!course)
return;



document.getElementById("edit-course-id").value =
course.id;


document.getElementById("edit-title").value =
course.title ?? "";


document.getElementById("edit-description").value =
course.description ?? "";


document.getElementById("edit-price").value =
course.price ?? "";


document.getElementById("edit-discount").value =
course.discount_price ?? "";


document.getElementById("edit-grade").value =
course.grade ?? "";


document.getElementById("edit-major").value =
course.major ?? "";


document.getElementById("edit-category").value =
course.category ?? "";


document.getElementById("edit-type").value =
course.type ?? "course";


document.getElementById("edit-image").value =
course.image_url ?? "";


openEditModal();


}








async function saveCourse(){


const courseId =
document.getElementById("edit-course-id").value;



const data = {


token,


title:
document.getElementById("edit-title").value,


description:
document.getElementById("edit-description").value || null,


price:
document.getElementById("edit-price").value || null,


discount_price:
document.getElementById("edit-discount").value || null,


grade:
document.getElementById("edit-grade").value || null,


major:
document.getElementById("edit-major").value || null,


category:
document.getElementById("edit-category").value || null,


type:
document.getElementById("edit-type").value,


image_url:
document.getElementById("edit-image").value || null


};





let result;



if(courseId){


result =
await apiCall(
"admin-update-course",
{

...data,

course_id:courseId

}
);



}
else{


result =
await apiCall(
"admin-create-course",
data
);



}




if(!result.success){

alert(result.error);

return;

}



closeEditModal();


await loadCourses();


}






function closeEditModal(){

document
.getElementById("edit-modal")
.classList.add("hidden");

}



function openEditModal(){

document
.getElementById("edit-modal")
.classList.remove("hidden");

}





function logout(){


localStorage.removeItem("session_token");

localStorage.removeItem("user");


window.location.href="login.html";


}



loadCourses();
const gradeSelect =
document.getElementById("edit-grade");


const majorSelect =
document.getElementById("edit-major");



gradeSelect.addEventListener(
"change",
()=>{


    if(gradeSelect.value==="9"){


        majorSelect.value="";

        majorSelect.disabled=true;

        majorSelect.classList.add(
            "bg-gray-100"
        );


    }
    else{


        majorSelect.disabled=false;

        majorSelect.classList.remove(
            "bg-gray-100"
        );


    }


});