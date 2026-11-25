const {HttpError}=require('./http');
const COURSES={
 BSA:'Bachelor of Science in Accountancy',
 BSIT:'Bachelor of Science in Information Technology',
 'BSBA-MM':'Bachelor of Science in Business Administration major in Marketing Management',
 'BSBA-HRM':'Bachelor of Science in Business Administration major in Human Resource Management',
 BSP:'Bachelor of Science in Psychology',
 BSECE:'Bachelor of Science in Electronics Engineering',
 BSIE:'Bachelor of Science in Industrial Engineering'
};
function validateProfile(courseCode,section){
 if(typeof courseCode!=='string'||!Object.hasOwn(COURSES,courseCode))throw new HttpError(400,'Choose a valid course.');
 if(typeof section!=='string')throw new HttpError(400,'Enter your section.');
 const clean=section.trim();
 if(!/^[1-9]-[1-9]$/.test(clean))throw new HttpError(400,'Enter a valid year-section, e.g. 4-3. Use one digit on each side of the hyphen.');
 return {courseCode,section:clean};
}
module.exports={COURSES,validateProfile};
