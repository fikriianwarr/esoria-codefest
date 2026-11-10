const critical = {'no-unreachable':'error','no-dupe-args':'error','no-dupe-keys':'error','valid-typeof':'error','constructor-super':'error','no-unsafe-finally':'error','no-constant-condition':['error',{checkLoops:false}]};
export default [
 {files:['functions/*.js','public/**/*.js','scripts/*.mjs'],languageOptions:{ecmaVersion:2024,sourceType:'module'},rules:critical},
 {files:['functions/*.js','public/competition-*.js','public/workspace.js','scripts/*.mjs'],rules:{'no-unused-vars':['error',{argsIgnorePattern:'^_',varsIgnorePattern:'^_'}]}},
 {files:['public/results-context.js','public/site-auth.js'],languageOptions:{globals:{document:'readonly',window:'readonly',location:'readonly',URL:'readonly',URLSearchParams:'readonly',console:'readonly'}},rules:{'no-undef':'error','no-unused-vars':'error'}}
];
