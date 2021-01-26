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
const deploy = require('netlify/src/deploy');

// Instantiate Netlify Client
const client = new NetlifyAPI(process.env.NETLIFY_TOKEN);

// Listen & update builds from Supabase
import { createClient } from '@supabase/supabase-js'

// Create a single supabase client for interacting with your database
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

/*
    ===============
    || Functions ||
    ===============
*/

// Process next item in queue
async function process_queue() {
    // Fetch latest queued property from supabase
    let { data, error } = await supabase
    .from('properties')
    .select()
    .eq('status','queued')
    .limit(1)
    .single();

    // Handle errors
    if(error) return handle_error(error);

    // Update selected property status to 'building'
    let { data, error } = await supabase
        .from('properties')
        .update({ status: 'building' })
        .eq({ id: data. id });

     // Handle errors
     if(error) return handle_error(error);
    
     // Define build timestamps for comparison
     let build_timestamps = {
         started: new Date(),
         completed: null
     };

     // Create build from property url
     await exec('goscrape ' + data.url);

     // Report build completed date
     build_timestamps.completed = new Date();

     // Calculate buildtime in seconds
     let seconds = (build_timestamps.completed.getTime() - build_timestamps.started.getTime()) / 1000;

     // Report build time via CLI
     console.log('Build for ' + data.url + ' completed in ' + seconds + ' seconds.');

     // If first deployment, instantiate deployment from build
     if(data.deployed) return instantiate_deployment(data);

     // Else, update existing deployment
     return update_deployment(data);

}

function handle_error(error) {
    if(!error) error = 'Error thrown but not found?';
        // Get error timestamp
        let error_timestamp = new Date();
        // Report error and timestamp
        console.log('Error encountered at ' + error_timestamp.getDate() + '/'
        + (error_timestamp.getMonth()+1)  + '/' 
        + error_timestamp.getFullYear() + ' @ '  
        + error_timestamp.getHours() + ':'  
        + error_timestamp.getMinutes() + ':' 
        + error_timestamp.getSeconds());
        // Retry processing queue
        return process_queue();
}

function instantiate_deployment(data) {
    // Instantiate deployment
    console.log('Instantiate deployment');
    console.log(data);
}

function update_deployment(data) {
    // Update deployment
    console.log('Update deployment');
    console.log(data);
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

/*
    ==========
    || Core ||
    ==========
*/

// Instantiate Tesla Coil by stating queue
return process_queue();