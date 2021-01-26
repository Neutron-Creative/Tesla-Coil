/*
    ===================
    || Configuration ||
    ==================
*/

// Pull environment variables from config
require('dotenv').config()

// Execute async processes in shell on behalf of user
const exec = require('await-exec')

// Make calls to Github API
const axios = require('axios');

// Deploy to Netlify
const NetlifyAPI = require('netlify');

// Instantiate Netlify Client
const netlify = new NetlifyAPI(process.env.NETLIFY_TOKEN);

// Listen & update builds from Supabase
const supabase_pkg = require('@supabase/supabase-js');

// Instantiate Supabase Client
const supabase = supabase_pkg.createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Define request interval in milliseconds && last request timestamp (for Supabase)
const request_interval = 1000; let last_request = null;

/*
    ===============
    || Functions ||
    ===============
*/

// Process next item in queue
async function process_queue() {
    // Check if last request exists
    if(!last_request) {
        // If last request doesn't exist, set and move forward without checking
        last_request = Date.now();
    } else {
        // Calculate time remaining from request interval - elapsed time
        let time_remaining = request_interval - (Date.now() - last_request);
        // Wait until time remaining has passed, then proceed
        if(time_remaining > 0) await new Promise(resolve => setTimeout(resolve, time_remaining));
    }
    // Fetch latest queued property from supabase
    let { data, error } = await supabase
    .from('builds')
    .select()
    .eq('status','queued')
    .limit(1)
    .single();

    // Handle errors
    if(error) return handle_error('fetching latest builds from queue', error);

    // Update selected property status to 'building'
    let pending_request = await supabase
        .from('builds')
        .update({ status: 'building' })
        .eq('id', data.id);

     // Handle errors
     if(pending_request.error) return handle_error('updating selected property status to building', pending_request.error);
    
     // Define build timestamps for comparison
     let build_timestamps = {
         started: new Date(),
         completed: null
     };

     let property = await supabase
        .from('properties')
        .select()
        .eq('id', data.property)
        .limit(1)
        .single();

    // Handle errors
     if(property.error) return handle_error('fetching property with build id', property.error);

     console.log('\nBeginning build of property ' + property.data.url);

     // Create build from property url
     await exec('goscrape ' + property.data.url + ' --output sites/' );

     // Report build completed date
     build_timestamps.completed = new Date();

     // Calculate buildtime in seconds
     let seconds = (build_timestamps.completed.getTime() - build_timestamps.started.getTime()) / 1000;

     // Report build time via CLI
     console.log('Build for ' + property.data.url + ' completed in ' + seconds + ' seconds.');

     // Load other deployments on property to check if first successful deployment
    let alt_deployments = await supabase
    .from('builds')
    .select()
    .eq('property', data.property)
    .eq('status', 'success');

     // If first deployment, instantiate deployment from build
     if(!alt_deployments.data || alt_deployments.data.length==0) return instantiate_deployment(data, property.data);

     // Else, update existing deployment
     return update_deployment(data, property.data);

}

function handle_error(label, error) {
    // If supabase throws error for no results, quietly ignore
    if(error?.message == 'JSON object requested, multiple (or no) rows returned') return process_queue();
    if(!error) error = 'Error thrown but not found?';
        // Get error timestamp
        let error_timestamp = new Date();
        // Report error timestamp
        console.log('Error encountered while ' + label + ' at ' + error_timestamp.getDate() + '/'
        + (error_timestamp.getMonth()+1)  + '/' 
        + error_timestamp.getFullYear() + ' @ '  
        + error_timestamp.getHours() + ':'  
        + error_timestamp.getMinutes() + ':' 
        + error_timestamp.getSeconds());
        // Report error
        console.log(error);
        // Retry processing queue
        return process_queue();
}

async function instantiate_deployment(data, property) {
    let response = await axios.post('https://api.github.com/orgs/' + process.env.GITHUB_ORGANIZATION + '/repos', {
        name: property.url,
        private: true
    }, {
        auth: {
            username: process.env.GITHUB_USER,
            password: process.env.GITHUB_TOKEN
        }
    });
    // If git respository could not be created
    if(response.error) return handle_error(response.error);
    // Initiate git repository locally
    await exec('cd ./sites/' + property.url + ' && git init && git remote add origin ' + response.data.ssh_url + ' && cd ../');
    // Finish loop & restart
    return finish_loop(data, property, response);
}

async function update_deployment(data, property) {
    // Finish loop & restart
    return finish_loop(data, property, false);
}

async function finish_loop(data, property, git_response) {
    // Define start timestamp for comparison
    let start = new Date();
    // Define command for git
    let git_cmd = 'cd ./sites/' + property.url + ' && git add . && git commit -m "Automated build from Tesla Coil at ' + Date.now() + '" && git branch -M master && git push -u origin master && cd ../';
    // Commit changes to git
    await exec(git_cmd);
    if(git_response) {
        // Deploy repo to Netlify
        let netlify_deployment = await axios.post('https://api.netlify.com/api/v1/sites', {
                                            name: 'NC-Tesla-Coil_' + property.url.split('.').join('-'),
                                            repo: {
                                                "provider":"github",
                                                "id":git_response.data.id,
                                                "repo":git_response.data.full_name,
                                                "private":true,
                                                "branch":"master",
                                                "cmd":"",
                                                //"deploy_key_id":process.env.NETLIFY_TOKEN
                                            }	
                                        }, { headers: { Authorization: `Bearer ${process.env.NETLIFY_TOKEN}` }});

        if(netlify_deployment.error) return handle_error('deploying repo to netlify', netlify_deployment.error);
        console.log('Property deployed successfully to https://' + netlify_deployment.data.default_domain);
    }
    let seconds = (new Date().getTime() - start.getTime()) / 1000;
    // Report site deployment
    console.log('Build for ' + property.url + ' successfully deployed in ' + seconds + ' seconds');
     // Update selected property status to 'success'
     let pending_request = await supabase
        .from('builds')
        .update({ status: 'success' })
        .eq('id', data.id);
    // Loop through queue again to restart
    return process_queue();
}
/*
    ============
    || Safety ||
    ============
*/

// Ensure Supabase Key is configured
if(!process.env.SUPABASE_KEY) {
    console.log('Cannot start Tesla Coil: Missing Supabase Key!');
    return process.exit(22);
}

// Ensure Supabase URL is configured
if(!process.env.SUPABASE_URL) {
    console.log('Cannot start Tesla Coil: Missing Supabase URL!');
    return process.exit(22);
}

// Ensure Netlify Token is configured
if(!process.env.NETLIFY_TOKEN) {
    console.log('Cannot start Tesla Coil: Missing Netlify Token!');
    return process.exit(22);
}

// Ensure Github Token is configured
if(!process.env.GITHUB_TOKEN) {
    console.log('Cannot start Tesla Coil: Missing Github Token!');
    return process.exit(22);
}

// Ensure Github Token is configured
if(!process.env.GITHUB_USER) {
    console.log('Cannot start Tesla Coil: Missing Github User!');
    return process.exit(22);
}

// Ensure Github Token is configured
if(!process.env.GITHUB_ORGANIZATION) {
    console.log('Cannot start Tesla Coil: Missing Github Organization!');
    return process.exit(22);
}

/*
    ==========
    || Core ||
    ==========
*/

console.log('======================================')
console.log('||      Welcome to Tesla Coil!      ||');
console.log('======================================')
console.log('||  Built by Neutron Creative Inc.  ||')
console.log('||        Licensed via GPLv3        ||');
console.log('======================================')
console.log('|| Tesla Coil is ready to strike ⚡ ||');
console.log('======================================')

// Instantiate Tesla Coil by stating queue
return process_queue();