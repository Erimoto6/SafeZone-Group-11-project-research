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
 const clean=section.trim().replace(/\s+/g,' ').toUpperCase();
 if(!clean||clean.length>40||/[\x00-\x1f\x7f]/.test(section))throw new HttpError(400,'Section must contain 1 to 40 characters on one line.');
 return {courseCode,section:clean};
}
module.exports={COURSES,validateProfile};
